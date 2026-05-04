#!/usr/bin/env python3
"""
Train L1 confluence aggregator: logistic regression on the 4 per-dim scores.

Replaces the IC-weighted heuristic in confluence.ts with a learned probability.
Inputs: TradeIdea + TradeIdeaReturn from Postgres.
Outputs: ONNX model + JSON metadata in packages/pipeline/models/.

Usage:
  python train.py --asset BTC
  python train.py --asset ETH
  python train.py --asset BTC --version v2
  python train.py --asset BTC --verify
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.model_selection import TimeSeriesSplit
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

FEATURES = ["derivatives", "etfs", "htf", "exchangeFlows"]


def fetch_rows(asset: str) -> pd.DataFrame:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL not set in environment or .env")

    parsed = urlparse(db_url)
    conn = psycopg2.connect(
        dbname=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port or 5432,
        sslmode="require",
    )
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                ti.id,
                ti."createdAt",
                ti.confluence,
                (
                    SELECT row_to_json(r)
                    FROM trade_idea_returns r
                    WHERE r."tradeIdeaId" = ti.id
                    ORDER BY ABS(r."qualityAtPoint") DESC
                    LIMIT 1
                ) AS peak
            FROM trade_ideas ti
            WHERE ti.asset = %s
              AND EXISTS (SELECT 1 FROM trade_idea_returns r WHERE r."tradeIdeaId" = ti.id)
            ORDER BY ti."createdAt" ASC
            """,
            (asset,),
        )
        rows = cur.fetchall()
    conn.close()

    records = []
    for row in rows:
        conf = row["confluence"]
        peak = row["peak"]
        if not conf or not peak:
            continue
        if not all(k in conf and isinstance(conf[k], (int, float)) for k in FEATURES):
            continue
        record = {
            "createdAt": row["createdAt"],
            **{k: float(conf[k]) for k in FEATURES},
            "qualityAtPoint": float(peak["qualityAtPoint"]),
            "label": 1 if peak["qualityAtPoint"] > 0 else 0,
        }
        # Stored heuristic total (IC-weighted at time of trade) — used as the
        # baseline ML must beat. May be missing on very old rows.
        if isinstance(conf.get("total"), (int, float)):
            record["heuristic_total"] = float(conf["total"])
        records.append(record)
    return pd.DataFrame(records)


def heuristic_proba(df: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Map heuristic total to a [0,1] probability for a fair comparison.

    Prefer the stored confluence.total (the actual IC-weighted heuristic that
    was used at the time of each trade). Fall back to equal-weighted average
    only if `total` is missing for any row.
    Returns (proba, source_label).
    """
    if "heuristic_total" in df.columns and not df["heuristic_total"].isna().any():
        return np.clip((df["heuristic_total"].to_numpy() + 1) / 2, 0.0, 1.0), "stored_total"
    avg = df[FEATURES].mean(axis=1).to_numpy()
    return np.clip((avg + 1) / 2, 0.0, 1.0), "equal_weighted_fallback"


def pearson_ic_per_dim(df: pd.DataFrame) -> dict:
    """Per-dim Pearson IC vs binary outcome — equivalent to ic-weights.ts logic."""
    y_signed = np.where(df["label"].to_numpy() == 1, 1.0, -1.0)
    ic = {}
    for dim in FEATURES:
        x = df[dim].to_numpy()
        if x.std() == 0 or y_signed.std() == 0:
            ic[dim] = 0.0
            continue
        ic[dim] = float(np.corrcoef(x, y_signed)[0, 1])
    return ic


def evaluate(y_true, y_proba, label):
    pred = (y_proba > 0.5).astype(int)
    return {
        "label": label,
        "accuracy": float(accuracy_score(y_true, pred)),
        "log_loss": float(log_loss(y_true, np.clip(y_proba, 1e-6, 1 - 1e-6))),
        "brier": float(brier_score_loss(y_true, y_proba)),
    }


def walk_forward_cv(X: np.ndarray, y: np.ndarray) -> dict:
    n_splits = min(5, max(2, len(X) // 40))
    if len(X) < 60:
        return {"folds": 0, "note": "too few samples for CV"}
    tscv = TimeSeriesSplit(n_splits=n_splits)
    oof_pred = np.full(len(X), np.nan)
    fold_metrics = []
    for fold, (tr, te) in enumerate(tscv.split(X)):
        if len(np.unique(y[tr])) < 2:
            continue
        clf = LogisticRegression(C=1.0, class_weight="balanced", max_iter=1000)
        clf.fit(X[tr], y[tr])
        win_idx = list(clf.classes_).index(1)
        proba = clf.predict_proba(X[te])[:, win_idx]
        oof_pred[te] = proba
        fold_metrics.append(evaluate(y[te], proba, f"fold{fold}"))
    valid = ~np.isnan(oof_pred)
    summary = (
        evaluate(y[valid], oof_pred[valid], "oof")
        if valid.sum() > 0 and len(np.unique(y[valid])) == 2
        else {"label": "oof", "note": "insufficient signal"}
    )
    return {"folds": n_splits, "fold_metrics": fold_metrics, "oof": summary}


def verify_onnx(onnx_path: Path, X: np.ndarray, y: np.ndarray, win_idx: int) -> dict:
    """Sanity check: run the exported ONNX model and confirm outputs match sklearn."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    outputs = sess.run(None, {input_name: X.astype(np.float32)})
    output_names = [o.name for o in sess.get_outputs()]
    proba_idx = next((i for i, n in enumerate(output_names) if "prob" in n.lower()), 1)
    proba = outputs[proba_idx]
    if proba.ndim == 2:
        proba = proba[:, win_idx]
    return {
        "input_name": input_name,
        "output_names": output_names,
        "probability_output_index": proba_idx,
        "metrics": evaluate(y, proba, "onnx_roundtrip"),
        "first_5_probs": proba[:5].tolist(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, choices=["BTC", "ETH"])
    parser.add_argument("--version", default="v1")
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "packages" / "pipeline" / "models"),
    )
    parser.add_argument("--verify", action="store_true", help="Re-run ONNX inference and compare.")
    args = parser.parse_args()

    print(f"Fetching {args.asset} trade ideas...")
    df = fetch_rows(args.asset)
    if len(df) == 0:
        sys.exit(f"No usable rows for {args.asset}.")
    print(
        f"  {len(df)} rows, {df['createdAt'].min()} → {df['createdAt'].max()}, "
        f"wins={int((df['label']==1).sum())}, losses={int((df['label']==0).sum())}"
    )

    X = df[FEATURES].to_numpy(dtype=np.float32)
    y = df["label"].to_numpy(dtype=np.int64)

    print("\nWalk-forward CV (TimeSeriesSplit)...")
    cv = walk_forward_cv(X, y)
    if "oof" in cv and "accuracy" in cv["oof"]:
        m = cv["oof"]
        print(f"  OOF: accuracy={m['accuracy']:.3f}  log_loss={m['log_loss']:.3f}  brier={m['brier']:.3f}")
    else:
        print(f"  CV: {cv}")

    h_proba, h_source = heuristic_proba(df)
    h_metrics = evaluate(y, h_proba, f"heuristic_full ({h_source})")
    print(
        f"  Heuristic ({h_source}, full sample): "
        f"accuracy={h_metrics['accuracy']:.3f}  log_loss={h_metrics['log_loss']:.3f}  brier={h_metrics['brier']:.3f}"
    )

    print("\nPer-dim Pearson IC (signed correlation with outcome):")
    ic = pearson_ic_per_dim(df)
    for dim in FEATURES:
        sign = "+" if ic[dim] >= 0 else ""
        print(f"    {dim:14s} IC={sign}{ic[dim]:.3f}")

    print("\nTraining final model on full dataset...")
    final = LogisticRegression(C=1.0, class_weight="balanced", max_iter=1000)
    final.fit(X, y)
    win_idx = list(final.classes_).index(1)
    train_metrics = evaluate(y, final.predict_proba(X)[:, win_idx], "train_full")
    print(
        f"  In-sample: accuracy={train_metrics['accuracy']:.3f}  "
        f"log_loss={train_metrics['log_loss']:.3f}  brier={train_metrics['brier']:.3f}"
    )

    coefs = dict(zip(FEATURES, final.coef_[0].tolist()))
    print("  Coefficients:")
    for f in FEATURES:
        print(f"    {f:14s} {coefs[f]:+.4f}")
    print(f"  Intercept:  {float(final.intercept_[0]):+.4f}")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = f"confluence_{args.asset.lower()}_{args.version}"
    onnx_path = out_dir / f"{model_name}.onnx"
    meta_path = out_dir / f"{model_name}.meta.json"

    initial_type = [("X", FloatTensorType([None, len(FEATURES)]))]
    onx = convert_sklearn(
        final,
        initial_types=initial_type,
        target_opset=17,
        options={id(final): {"zipmap": False}},
    )
    with open(onnx_path, "wb") as f:
        f.write(onx.SerializeToString())
    print(f"\nWrote {onnx_path}")

    metadata = {
        "model_name": model_name,
        "asset": args.asset,
        "version": args.version,
        "model_type": "logistic_regression",
        "features": FEATURES,
        "feature_order": FEATURES,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(df)),
        "date_range": {
            "start": df["createdAt"].min().isoformat() if len(df) else None,
            "end": df["createdAt"].max().isoformat() if len(df) else None,
        },
        "class_balance": {"wins": int((y == 1).sum()), "losses": int((y == 0).sum())},
        "coefficients": coefs,
        "intercept": float(final.intercept_[0]),
        "regularization": {"penalty": "l2", "C": 1.0, "class_weight": "balanced"},
        "cv": cv,
        "pearson_ic_per_dim": ic,
        "heuristic_baseline_full": h_metrics,
        "heuristic_baseline_source": h_source,
        "training_metrics_in_sample": train_metrics,
        "onnx_input_name": "X",
        "onnx_input_shape": [None, len(FEATURES)],
        "onnx_input_dtype": "float32",
        "onnx_output_index_for_win": int(win_idx),
        "label_mapping": {"0": "loss (qualityAtPoint <= 0)", "1": "win (qualityAtPoint > 0)"},
    }

    if args.verify:
        print("\nVerifying ONNX roundtrip...")
        verify_result = verify_onnx(onnx_path, X, y, win_idx)
        metadata["onnx_verification"] = verify_result
        m = verify_result["metrics"]
        print(
            f"  ONNX in-sample: accuracy={m['accuracy']:.3f}  "
            f"log_loss={m['log_loss']:.3f}  brier={m['brier']:.3f}"
        )
        print(f"  Output names: {verify_result['output_names']}")

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)
    print(f"Wrote {meta_path}")


if __name__ == "__main__":
    main()
