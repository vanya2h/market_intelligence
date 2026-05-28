#!/usr/bin/env python3
"""
Train per-dimension intra-dim sub-model (L2a).

Reads rawFeatures.<dim> from TradeIdea rows, trains a logistic regression
with L1 regularization on the market-direction label, and exports ONNX.

Label semantics (market direction, not trade success):
  LONG + qualityAtPoint > 0  → price went UP   → label 1
  LONG + qualityAtPoint < 0  → price went DOWN  → label 0
  SHORT + qualityAtPoint > 0 → SHORT won = price DOWN → label 0
  SHORT + qualityAtPoint < 0 → SHORT lost = price UP  → label 1

This is different from train.py (L1) which labels on trade success. The
per-dim model must answer "should we buy?" not "did our choice win?".

Usage:
  python train_dim.py --dim DERIVATIVES --asset BTC
  python train_dim.py --dim HTF --asset ETH --version v2 --verify
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

SCHEMA_PATH = Path(__file__).parent / "feature_schema.json"
with open(SCHEMA_PATH) as f:
    FEATURE_SCHEMA = json.load(f)

VALID_DIMS = list(FEATURE_SCHEMA["feature_sets"].keys())


# ─── Feature list ────────────────────────────────────────────────────────────


def feature_names(dim: str) -> list[str]:
    """Canonical feature order for a dimension — must match extract-features.ts exactly."""
    fs = FEATURE_SCHEMA["feature_sets"][dim]
    names = list(fs.get("numeric", []))
    names += [c["key"] for c in fs.get("categorical", [])]
    names += [b["key"] for b in fs.get("boolean", [])]
    return names


# ─── DB ──────────────────────────────────────────────────────────────────────


def connect():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL not set in environment or .env")
    p = urlparse(db_url)
    return psycopg2.connect(
        dbname=p.path.lstrip("/"),
        user=p.username,
        password=p.password,
        host=p.hostname,
        port=p.port or 5432,
        sslmode="require",
    )


def fetch_rows(asset: str, dim: str) -> pd.DataFrame:
    conn = connect()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                ti.id,
                ti."createdAt",
                ti.direction,
                ti.confluence AS confluence,
                ti.confluence -> 'rawFeatures' -> %(dim)s AS raw_features,
                (
                    SELECT row_to_json(r)
                    FROM trade_idea_returns r
                    WHERE r."tradeIdeaId" = ti.id
                    ORDER BY ABS(r."qualityAtPoint") DESC
                    LIMIT 1
                ) AS peak
            FROM trade_ideas ti
            WHERE ti.asset = %(asset)s
              AND ti.direction IN ('LONG', 'SHORT')
              AND ti.confluence -> 'rawFeatures' -> %(dim)s IS NOT NULL
              AND EXISTS (
                    SELECT 1 FROM trade_idea_returns r
                    WHERE r."tradeIdeaId" = ti.id
              )
            ORDER BY ti."createdAt" ASC
            """,
            {"asset": asset, "dim": dim},
        )
        rows = cur.fetchall()
    conn.close()

    feat_names = feature_names(dim)
    records = []
    for row in rows:
        peak = row["peak"]
        raw = row["raw_features"]
        if not peak or not raw:
            continue

        quality = float(peak["qualityAtPoint"])
        direction = row["direction"]

        # Market-direction label: 1 = price went up, 0 = price went down
        if direction == "LONG":
            went_up = quality > 0
        elif direction == "SHORT":
            went_up = quality < 0
        else:
            continue  # FLAT — skip

        # Extract features in canonical order; missing keys default to 0.0
        features = {name: float(raw.get(name, 0.0)) for name in feat_names}

        # Per-dim heuristic score stored at trade time (handles both old lowercase
        # and new uppercase enum-keyed formats)
        conf = row["confluence"] or {}
        heuristic = conf.get(dim) or conf.get(dim.lower()) or conf.get(_legacy_key(dim))

        record = {
            "createdAt": row["createdAt"],
            "label": int(went_up),
            "qualityAtPoint": quality,
            **features,
        }
        if isinstance(heuristic, (int, float)):
            record["heuristic_score"] = float(heuristic)
        records.append(record)

    return pd.DataFrame(records)


def _legacy_key(dim: str) -> str:
    """Map EXCHANGE_FLOWS → exchangeFlows etc. for old lowercase-key rows."""
    mapping = {
        "DERIVATIVES": "derivatives",
        "ETFS": "etfs",
        "HTF": "htf",
        "EXCHANGE_FLOWS": "exchangeFlows",
    }
    return mapping.get(dim, dim.lower())


# ─── Metrics ─────────────────────────────────────────────────────────────────


def evaluate(y_true, y_proba, label):
    pred = (y_proba > 0.5).astype(int)
    return {
        "label": label,
        "accuracy": float(accuracy_score(y_true, pred)),
        "log_loss": float(log_loss(y_true, np.clip(y_proba, 1e-6, 1 - 1e-6))),
        "brier": float(brier_score_loss(y_true, y_proba)),
    }


def walk_forward_cv(X: np.ndarray, y: np.ndarray, C: float) -> dict:
    n_splits = min(5, max(2, len(X) // 40))
    if len(X) < 60:
        return {"folds": 0, "note": "too few samples for CV"}
    tscv = TimeSeriesSplit(n_splits=n_splits)
    oof_pred = np.full(len(X), np.nan)
    fold_metrics = []
    for fold, (tr, te) in enumerate(tscv.split(X)):
        if len(np.unique(y[tr])) < 2:
            continue
        clf = LogisticRegression(
            l1_ratio=1, solver="liblinear", C=C,
            class_weight="balanced", max_iter=1000,
        )
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


def pearson_ic(df: pd.DataFrame, feat_names: list[str]) -> dict:
    y = np.where(df["label"].to_numpy() == 1, 1.0, -1.0)
    ic = {}
    for f in feat_names:
        x = df[f].to_numpy()
        if x.std() == 0 or y.std() == 0:
            ic[f] = 0.0
        else:
            ic[f] = float(np.corrcoef(x, y)[0, 1])
    return ic


# ─── ONNX verification ────────────────────────────────────────────────────────


def verify_onnx(onnx_path: Path, X: np.ndarray, y: np.ndarray, win_idx: int) -> dict:
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


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dim", required=True, choices=VALID_DIMS)
    parser.add_argument("--asset", required=True, choices=["BTC", "ETH"])
    parser.add_argument("--version", default="v1")
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "packages" / "pipeline" / "models"),
    )
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--C", type=float, default=1.0,
                        help="L1 regularization inverse strength. Higher = less regularization. "
                             "Use --C 3.0 for ETFS dims to let streak features survive pruning.")
    args = parser.parse_args()

    feat_names = feature_names(args.dim)
    print(f"Dim: {args.dim}  Asset: {args.asset}  Features: {len(feat_names)}")

    print(f"\nFetching {args.asset}/{args.dim} trade ideas with rawFeatures...")
    df = fetch_rows(args.asset, args.dim)
    if len(df) == 0:
        sys.exit(f"No usable rows for {args.asset}/{args.dim}.")

    wins = int((df["label"] == 1).sum())
    losses = int((df["label"] == 0).sum())
    print(
        f"  {len(df)} rows, {df['createdAt'].min()} → {df['createdAt'].max()}, "
        f"went_up={wins}, went_down={losses}"
    )

    # Cap reversalRatio — extreme outliers (e.g. 130x when prior streak was tiny)
    # blow up the logit; anything beyond 3x carries no additional information.
    if "reversalRatio" in df.columns:
        df["reversalRatio"] = df["reversalRatio"].clip(upper=3.0)

    X = df[feat_names].to_numpy(dtype=np.float32)
    y = df["label"].to_numpy(dtype=np.int64)

    # ── Heuristic baseline ─────────────────────────────────────────────────
    if "heuristic_score" in df.columns and not df["heuristic_score"].isna().any():
        h_proba = np.clip((df["heuristic_score"].to_numpy() + 1) / 2, 0.0, 1.0)
        h_metrics = evaluate(y, h_proba, f"heuristic_{args.dim}")
        print(
            f"\n  Heuristic baseline ({args.dim}): "
            f"accuracy={h_metrics['accuracy']:.3f}  "
            f"log_loss={h_metrics['log_loss']:.3f}  "
            f"brier={h_metrics['brier']:.3f}"
        )
    else:
        print("\n  Heuristic baseline: not available for this dim/asset")
        h_metrics = None

    # ── Walk-forward CV ────────────────────────────────────────────────────
    print(f"\nWalk-forward CV (L1, TimeSeriesSplit, C={args.C})...")
    cv = walk_forward_cv(X, y, C=args.C)
    if "oof" in cv and "accuracy" in cv.get("oof", {}):
        m = cv["oof"]
        print(f"  OOF: accuracy={m['accuracy']:.3f}  log_loss={m['log_loss']:.3f}  brier={m['brier']:.3f}")
    else:
        print(f"  CV: {cv}")

    # ── Per-feature IC ─────────────────────────────────────────────────────
    print("\nPer-feature Pearson IC (vs went_up label):")
    ic = pearson_ic(df, feat_names)
    top = sorted(ic.items(), key=lambda kv: abs(kv[1]), reverse=True)[:10]
    for feat, v in top:
        sign = "+" if v >= 0 else ""
        print(f"    {feat:<32s} IC={sign}{v:.3f}")

    # ── Final model ────────────────────────────────────────────────────────
    print("\nTraining final model on full dataset...")
    final = LogisticRegression(
        l1_ratio=1, solver="liblinear", C=args.C,
        class_weight="balanced", max_iter=1000,
    )
    final.fit(X, y)
    win_idx = list(final.classes_).index(1)
    train_metrics = evaluate(y, final.predict_proba(X)[:, win_idx], "train_full")
    print(
        f"  In-sample: accuracy={train_metrics['accuracy']:.3f}  "
        f"log_loss={train_metrics['log_loss']:.3f}  brier={train_metrics['brier']:.3f}"
    )

    # Top non-zero coefficients
    nonzero = [(f, c) for f, c in zip(feat_names, final.coef_[0]) if c != 0.0]
    nonzero.sort(key=lambda fc: abs(fc[1]), reverse=True)
    print(f"  Non-zero coefficients: {len(nonzero)} / {len(feat_names)}")
    for feat, coef in nonzero[:10]:
        print(f"    {feat:<32s} {coef:+.4f}")
    print(f"  Intercept: {float(final.intercept_[0]):+.4f}")

    # ── Export ────────────────────────────────────────────────────────────
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = f"dim_{args.dim.lower()}_{args.asset.lower()}_{args.version}"
    onnx_path = out_dir / f"{model_name}.onnx"
    meta_path = out_dir / f"{model_name}.meta.json"

    initial_type = [("X", FloatTensorType([None, len(feat_names)]))]
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
        "dim": args.dim,
        "asset": args.asset,
        "version": args.version,
        "model_type": "logistic_regression_l1",
        "label": "went_up: 1=price_went_up, 0=price_went_down",
        "feature_order": feat_names,
        "n_features": len(feat_names),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(df)),
        "date_range": {
            "start": df["createdAt"].min().isoformat() if len(df) else None,
            "end": df["createdAt"].max().isoformat() if len(df) else None,
        },
        "class_balance": {"went_up": wins, "went_down": losses},
        "non_zero_coefficients": {f: float(c) for f, c in nonzero},
        "intercept": float(final.intercept_[0]),
        "regularization": {"l1_ratio": 1, "C": 1.0, "solver": "liblinear", "class_weight": "balanced"},
        "cv": cv,
        "pearson_ic_top10": {f: float(v) for f, v in top},
        "heuristic_baseline": h_metrics,
        "training_metrics_in_sample": train_metrics,
        "onnx_input_name": "X",
        "onnx_input_shape": [None, len(feat_names)],
        "onnx_input_dtype": "float32",
        "onnx_output_index_for_win": int(win_idx),
        "label_mapping": {"0": "went_down (price fell)", "1": "went_up (price rose)"},
    }

    if args.verify:
        print("\nVerifying ONNX roundtrip...")
        verify_result = verify_onnx(onnx_path, X, y, win_idx)
        metadata["onnx_verification"] = verify_result
        m = verify_result["metrics"]
        print(
            f"  ONNX in-sample: accuracy={m['accuracy']:.3f}  "
            f"brier={m['brier']:.3f}"
        )

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)
    print(f"Wrote {meta_path}")


if __name__ == "__main__":
    main()
