#!/usr/bin/env python3
"""
Train per-dimension intra-dim sub-model (L2a) — momentum regression.

Reads rawFeatures.<dim> from TradeIdea rows, trains a Lasso regression
(L1-regularized) on a normalized qualityAtPoint target, and exports ONNX.

Label semantics (trend strength, not direction):
  qualityAtPoint > 0 and large  → strong upward momentum  → target near +1
  qualityAtPoint < 0 and large  → strong downward momentum → target near -1
  qualityAtPoint near 0         → choppy / no trend        → target near 0

Label normalization: clip(qualityAtPoint / (3 * std), -1, 1)
Maps 3-sigma returns to ±1. The model learns to predict trend strength.

Model output: a scalar in roughly [-1, +1] representing trend strength.
Positive = bullish trend; negative = bearish trend; near-zero = no trend.

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
from sklearn.linear_model import Lasso
from sklearn.metrics import mean_absolute_error, r2_score
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
        if direction not in ("LONG", "SHORT"):
            continue

        features = {name: float(raw.get(name, 0.0)) for name in feat_names}

        conf = row["confluence"] or {}
        heuristic = conf.get(dim) or conf.get(dim.lower()) or conf.get(_legacy_key(dim))

        record = {
            "createdAt": row["createdAt"],
            "qualityAtPoint": quality,
            **features,
        }
        if isinstance(heuristic, (int, float)):
            record["heuristic_score"] = float(heuristic)
        records.append(record)

    return pd.DataFrame(records)


def _legacy_key(dim: str) -> str:
    mapping = {
        "DERIVATIVES": "derivatives",
        "ETFS": "etfs",
        "HTF": "htf",
        "EXCHANGE_FLOWS": "exchangeFlows",
    }
    return mapping.get(dim, dim.lower())


# ─── Metrics ─────────────────────────────────────────────────────────────────


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
        reg = Lasso(alpha=alpha, max_iter=10000)
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


def pearson_ic(df: pd.DataFrame, feat_names: list[str], y: np.ndarray) -> dict:
    ic = {}
    for f in feat_names:
        x = df[f].to_numpy()
        if x.std() == 0 or y.std() == 0:
            ic[f] = 0.0
        else:
            ic[f] = float(np.corrcoef(x, y)[0, 1])
    return ic


# ─── ONNX verification ────────────────────────────────────────────────────────


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
    parser.add_argument("--alpha", type=float, default=0.05,
                        help="Lasso L1 regularization strength. Higher = sparser. "
                             "Default 0.05 is moderate — increase for small datasets.")
    args = parser.parse_args()

    feat_names = feature_names(args.dim)
    print(f"Dim: {args.dim}  Asset: {args.asset}  Features: {len(feat_names)}")

    print(f"\nFetching {args.asset}/{args.dim} trade ideas with rawFeatures...")
    df = fetch_rows(args.asset, args.dim)
    if len(df) == 0:
        sys.exit(f"No usable rows for {args.asset}/{args.dim}.")

    print(
        f"  {len(df)} rows, {df['createdAt'].min()} → {df['createdAt'].max()}"
    )

    # Cap reversalRatio — extreme outliers blow up the regression
    if "reversalRatio" in df.columns:
        df["reversalRatio"] = df["reversalRatio"].clip(upper=3.0)

    # Normalize qualityAtPoint → trend strength target in [-1, +1]
    # clip(quality / (3 * std), -1, 1) maps 3-sigma returns to ±1
    q_std = float(df["qualityAtPoint"].std())
    if q_std == 0:
        sys.exit("All qualityAtPoint values identical — cannot train.")
    quality_scale = 3.0 * q_std
    y_raw = df["qualityAtPoint"].to_numpy(dtype=np.float64)
    y = np.clip(y_raw / quality_scale, -1.0, 1.0).astype(np.float64)

    print(f"  qualityAtPoint std={q_std:.4f}  scale={quality_scale:.4f}")
    print(f"  y range: [{y.min():.3f}, {y.max():.3f}]  mean={y.mean():.3f}")

    X = df[feat_names].to_numpy(dtype=np.float32)

    # ── Heuristic baseline ─────────────────────────────────────────────────
    if "heuristic_score" in df.columns and not df["heuristic_score"].isna().any():
        h_pred = df["heuristic_score"].to_numpy(dtype=np.float64)
        h_metrics = evaluate(y, h_pred, f"heuristic_{args.dim}")
        print(
            f"\n  Heuristic baseline ({args.dim}): "
            f"R²={h_metrics['r2']:.3f}  MAE={h_metrics['mae']:.3f}  IC={h_metrics['pearson_ic']:+.3f}"
        )
    else:
        print("\n  Heuristic baseline: not available for this dim/asset")
        h_metrics = None

    # ── Walk-forward CV ────────────────────────────────────────────────────
    print(f"\nWalk-forward CV (Lasso, TimeSeriesSplit, alpha={args.alpha})...")
    cv = walk_forward_cv(X, y.astype(np.float32), alpha=args.alpha)
    if "oof" in cv and "pearson_ic" in cv.get("oof", {}):
        m = cv["oof"]
        print(f"  OOF: R²={m['r2']:.3f}  MAE={m['mae']:.3f}  IC={m['pearson_ic']:+.3f}")
    else:
        print(f"  CV: {cv}")

    # ── Per-feature IC ─────────────────────────────────────────────────────
    print("\nPer-feature Pearson IC (vs trend strength target):")
    ic = pearson_ic(df, feat_names, y)
    top = sorted(ic.items(), key=lambda kv: abs(kv[1]), reverse=True)[:10]
    for feat, v in top:
        sign = "+" if v >= 0 else ""
        print(f"    {feat:<32s} IC={sign}{v:.3f}")

    # ── Final model ────────────────────────────────────────────────────────
    print("\nTraining final model on full dataset...")
    final = Lasso(alpha=args.alpha, max_iter=10000)
    final.fit(X, y.astype(np.float32))
    train_pred = final.predict(X)
    train_metrics = evaluate(y, train_pred, "train_full")
    print(
        f"  In-sample: R²={train_metrics['r2']:.3f}  "
        f"MAE={train_metrics['mae']:.3f}  IC={train_metrics['pearson_ic']:+.3f}"
    )

    nonzero = [(f, c) for f, c in zip(feat_names, final.coef_) if c != 0.0]
    nonzero.sort(key=lambda fc: abs(fc[1]), reverse=True)
    print(f"  Non-zero coefficients: {len(nonzero)} / {len(feat_names)}")
    for feat, coef in nonzero[:10]:
        print(f"    {feat:<32s} {coef:+.4f}")
    print(f"  Intercept: {float(final.intercept_):+.4f}")

    # ── Export ────────────────────────────────────────────────────────────
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = f"dim_{args.dim.lower()}_{args.asset.lower()}_{args.version}"
    onnx_path = out_dir / f"{model_name}.onnx"
    meta_path = out_dir / f"{model_name}.meta.json"

    initial_type = [("X", FloatTensorType([None, len(feat_names)]))]
    onx = convert_sklearn(final, initial_types=initial_type, target_opset=17)
    with open(onnx_path, "wb") as f:
        f.write(onx.SerializeToString())
    print(f"\nWrote {onnx_path}")

    metadata = {
        "model_name": model_name,
        "dim": args.dim,
        "asset": args.asset,
        "version": args.version,
        "model_type": "lasso_regression",
        "label": "trend_strength: clip(qualityAtPoint / quality_scale, -1, 1)",
        "quality_scale": quality_scale,
        "feature_order": feat_names,
        "n_features": len(feat_names),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(df)),
        "date_range": {
            "start": df["createdAt"].min().isoformat() if len(df) else None,
            "end": df["createdAt"].max().isoformat() if len(df) else None,
        },
        "non_zero_coefficients": {f: float(c) for f, c in nonzero},
        "intercept": float(final.intercept_),
        "regularization": {"penalty": "l1", "alpha": args.alpha, "solver": "lasso"},
        "cv": cv,
        "pearson_ic_top10": {f: float(v) for f, v in top},
        "heuristic_baseline": h_metrics,
        "training_metrics_in_sample": train_metrics,
        "onnx_input_name": "X",
        "onnx_input_shape": [None, len(feat_names)],
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
