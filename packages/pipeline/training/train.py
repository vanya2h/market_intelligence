#!/usr/bin/env python3
"""
Train L1 confluence aggregator — momentum regression.

Replaces the IC-weighted heuristic in confluence.ts with a learned trend
strength score. Inputs are the four per-dim scores (ML-corrected or heuristic).
Output is a scalar in [-1, +1]: positive = bullish trend, negative = bearish.

Label: clip(qualityAtPoint / (3 * std), -1, 1) — same normalization as L2a.
Model: Ridge regression (L2-regularized) — stable with only 4 input features.

Usage:
  python train.py --asset BTC
  python train.py --asset ETH
  python train.py --asset BTC --version v2 --verify
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
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
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
        }
        if isinstance(conf.get("total"), (int, float)):
            record["heuristic_total"] = float(conf["total"])
        records.append(record)
    return pd.DataFrame(records)


def evaluate(y_true: np.ndarray, y_pred: np.ndarray, label: str) -> dict:
    ic = float(np.corrcoef(y_true, y_pred)[0, 1]) if y_true.std() > 0 and y_pred.std() > 0 else 0.0
    return {
        "label": label,
        "r2": float(r2_score(y_true, y_pred)),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "pearson_ic": ic,
    }


def walk_forward_cv(X: np.ndarray, y: np.ndarray, alpha: float) -> dict:
    n_splits = min(5, max(2, len(X) // 40))
    if len(X) < 60:
        return {"folds": 0, "note": "too few samples for CV"}
    tscv = TimeSeriesSplit(n_splits=n_splits)
    oof_pred = np.full(len(X), np.nan)
    fold_metrics = []
    for fold, (tr, te) in enumerate(tscv.split(X)):
        reg = Ridge(alpha=alpha)
        reg.fit(X[tr], y[tr])
        pred = reg.predict(X[te])
        oof_pred[te] = pred
        fold_metrics.append(evaluate(y[te], pred, f"fold{fold}"))
    valid = ~np.isnan(oof_pred)
    summary = (
        evaluate(y[valid], oof_pred[valid], "oof")
        if valid.sum() > 0
        else {"label": "oof", "note": "insufficient signal"}
    )
    return {"folds": n_splits, "fold_metrics": fold_metrics, "oof": summary}


def pearson_ic_per_dim(df: pd.DataFrame, y: np.ndarray) -> dict:
    ic = {}
    for dim in FEATURES:
        x = df[dim].to_numpy()
        if x.std() == 0 or y.std() == 0:
            ic[dim] = 0.0
            continue
        ic[dim] = float(np.corrcoef(x, y)[0, 1])
    return ic


def verify_onnx(onnx_path: Path, X: np.ndarray, y: np.ndarray) -> dict:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    output_name = sess.get_outputs()[0].name
    outputs = sess.run([output_name], {input_name: X.astype(np.float32)})
    pred = np.array(outputs[0]).flatten()
    return {
        "input_name": input_name,
        "output_name": output_name,
        "metrics": evaluate(y, pred, "onnx_roundtrip"),
        "first_5_preds": pred[:5].tolist(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, choices=["BTC", "ETH"])
    parser.add_argument("--version", default="v1")
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "packages" / "pipeline" / "models"),
    )
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--alpha", type=float, default=1.0,
                        help="Ridge L2 regularization strength. Default 1.0.")
    args = parser.parse_args()

    print(f"Fetching {args.asset} trade ideas...")
    df = fetch_rows(args.asset)
    if len(df) == 0:
        sys.exit(f"No usable rows for {args.asset}.")
    print(
        f"  {len(df)} rows, {df['createdAt'].min()} → {df['createdAt'].max()}"
    )

    # Normalize qualityAtPoint → trend strength target in [-1, +1]
    q_std = float(df["qualityAtPoint"].std())
    if q_std == 0:
        sys.exit("All qualityAtPoint values identical — cannot train.")
    quality_scale = 3.0 * q_std
    y_raw = df["qualityAtPoint"].to_numpy(dtype=np.float64)
    y = np.clip(y_raw / quality_scale, -1.0, 1.0).astype(np.float64)

    print(f"  qualityAtPoint std={q_std:.4f}  scale={quality_scale:.4f}")
    print(f"  y range: [{y.min():.3f}, {y.max():.3f}]  mean={y.mean():.3f}")

    X = df[FEATURES].to_numpy(dtype=np.float32)

    print("\nWalk-forward CV (Ridge, TimeSeriesSplit)...")
    cv = walk_forward_cv(X, y, alpha=args.alpha)
    if "oof" in cv and "pearson_ic" in cv.get("oof", {}):
        m = cv["oof"]
        print(f"  OOF: R²={m['r2']:.3f}  MAE={m['mae']:.3f}  IC={m['pearson_ic']:+.3f}")
    else:
        print(f"  CV: {cv}")

    # Heuristic baseline
    if "heuristic_total" in df.columns and not df["heuristic_total"].isna().any():
        h_pred = df["heuristic_total"].to_numpy(dtype=np.float64)
        h_metrics = evaluate(y, h_pred, "heuristic_full")
        print(
            f"  Heuristic: R²={h_metrics['r2']:.3f}  MAE={h_metrics['mae']:.3f}  IC={h_metrics['pearson_ic']:+.3f}"
        )
    else:
        h_metrics = None

    print("\nPer-dim Pearson IC (vs trend strength):")
    ic = pearson_ic_per_dim(df, y)
    for dim in FEATURES:
        sign = "+" if ic[dim] >= 0 else ""
        print(f"    {dim:14s} IC={sign}{ic[dim]:.3f}")

    print("\nTraining final model on full dataset...")
    final = Ridge(alpha=args.alpha)
    final.fit(X, y)
    train_pred = final.predict(X)
    train_metrics = evaluate(y, train_pred, "train_full")
    print(
        f"  In-sample: R²={train_metrics['r2']:.3f}  "
        f"MAE={train_metrics['mae']:.3f}  IC={train_metrics['pearson_ic']:+.3f}"
    )

    coefs = dict(zip(FEATURES, final.coef_.tolist()))
    print("  Coefficients:")
    for f in FEATURES:
        print(f"    {f:14s} {coefs[f]:+.4f}")
    print(f"  Intercept:  {float(final.intercept_):+.4f}")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = f"confluence_{args.asset.lower()}_{args.version}"
    onnx_path = out_dir / f"{model_name}.onnx"
    meta_path = out_dir / f"{model_name}.meta.json"

    initial_type = [("X", FloatTensorType([None, len(FEATURES)]))]
    onx = convert_sklearn(final, initial_types=initial_type, target_opset=17)
    with open(onnx_path, "wb") as f:
        f.write(onx.SerializeToString())
    print(f"\nWrote {onnx_path}")

    metadata = {
        "model_name": model_name,
        "asset": args.asset,
        "version": args.version,
        "model_type": "ridge_regression",
        "label": "trend_strength: clip(qualityAtPoint / quality_scale, -1, 1)",
        "quality_scale": quality_scale,
        "features": FEATURES,
        "feature_order": FEATURES,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(df)),
        "date_range": {
            "start": df["createdAt"].min().isoformat() if len(df) else None,
            "end": df["createdAt"].max().isoformat() if len(df) else None,
        },
        "coefficients": coefs,
        "intercept": float(final.intercept_),
        "regularization": {"penalty": "l2", "alpha": args.alpha},
        "cv": cv,
        "pearson_ic_per_dim": ic,
        "heuristic_baseline_full": h_metrics,
        "training_metrics_in_sample": train_metrics,
        "onnx_input_name": "X",
        "onnx_input_shape": [None, len(FEATURES)],
        "onnx_input_dtype": "float32",
        "onnx_output_name": "variable",
    }

    if args.verify:
        print("\nVerifying ONNX roundtrip...")
        verify_result = verify_onnx(onnx_path, X, y)
        metadata["onnx_verification"] = verify_result
        m = verify_result["metrics"]
        print(f"  ONNX in-sample: R²={m['r2']:.3f}  IC={m['pearson_ic']:+.3f}")

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)
    print(f"Wrote {meta_path}")


if __name__ == "__main__":
    main()
