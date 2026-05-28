#!/usr/bin/env python3
"""
Compare snapshot model OOF IC across all available horizons.

Reads the same CSV as train_snapshot.py, runs walk-forward CV for each horizon,
and prints a ranking table so you can see which prediction window the features
are most informative about.

Usage:
  python compare_horizons.py --asset BTC
  python compare_horizons.py --asset BTC --alpha 10 --horizons 24 48 72 168
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import TimeSeriesSplit
from scipy import stats

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

SCHEMA_PATH = Path(__file__).parent / "feature_schema.json"
with open(SCHEMA_PATH) as f:
    FEATURE_SCHEMA = json.load(f)

DIM_ORDER = ["DERIVATIVES", "ETFS", "HTF", "EXCHANGE_FLOWS"]


def feature_names_for_dim(dim: str) -> list[str]:
    fs = FEATURE_SCHEMA["feature_sets"][dim]
    keys = list(fs.get("numeric", []))
    keys += [c["key"] for c in fs.get("categorical", [])]
    keys += [b["key"] for b in fs.get("boolean", [])]
    return [f"{dim}_{k}" for k in keys]


def all_feature_names() -> list[str]:
    names = []
    for dim in DIM_ORDER:
        names.extend(feature_names_for_dim(dim))
    return names


def pearson_ic(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[float, float]:
    if y_true.std() == 0 or y_pred.std() == 0:
        return 0.0, 1.0
    ic, p = stats.pearsonr(y_true, y_pred)
    return float(ic), float(p)


def spearman_ic(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    if y_true.std() == 0 or y_pred.std() == 0:
        return 0.0
    return float(stats.spearmanr(y_true, y_pred).statistic)


def hit_rate(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Fraction of rows where sign(pred) == sign(label)."""
    mask = (y_true != 0) & (y_pred != 0)
    if mask.sum() == 0:
        return float("nan")
    return float((np.sign(y_true[mask]) == np.sign(y_pred[mask])).mean())


def run_cv(X: np.ndarray, y: np.ndarray, alpha: float, timestamps: pd.Series) -> dict:
    n = len(X)
    if n < 60:
        return {"error": f"only {n} rows — need ≥ 60"}
    n_splits = min(5, max(2, n // 40))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    oof_pred = np.full(n, np.nan)
    fold_ics = []
    for tr, te in tscv.split(X):
        reg = Ridge(alpha=alpha)
        reg.fit(X[tr], y[tr])
        pred = reg.predict(X[te])
        oof_pred[te] = pred
        fold_ic, _ = pearson_ic(y[te], pred)
        te_start = timestamps.iloc[te[0]][:10]
        te_end = timestamps.iloc[te[-1]][:10]
        fold_ics.append({"ic": fold_ic, "n": len(te), "period": f"{te_start}→{te_end}"})
    valid = ~np.isnan(oof_pred)
    if valid.sum() < 10:
        return {"error": "insufficient OOF predictions"}
    yv, pv = y[valid], oof_pred[valid]
    ic, p_val = pearson_ic(yv, pv)
    # In-sample IC on full data (overfitting diagnostic)
    reg_full = Ridge(alpha=alpha)
    reg_full.fit(X, y)
    insample_ic, _ = pearson_ic(y, reg_full.predict(X))
    return {
        "n": int(valid.sum()),
        "pearson_ic": ic,
        "spearman_ic": spearman_ic(yv, pv),
        "p_value": p_val,
        "hit_rate": hit_rate(yv, pv),
        "mae": float(mean_absolute_error(yv, pv)),
        "r2": float(r2_score(yv, pv)),
        "insample_ic": insample_ic,
        "n_splits": n_splits,
        "fold_ics": fold_ics,
    }


def top_features(X: np.ndarray, y: np.ndarray, names: list[str], n: int = 5) -> list[tuple[str, float]]:
    ics = {}
    for i, name in enumerate(names):
        col = X[:, i].astype(np.float64)
        if col.std() > 0 and y.std() > 0:
            ics[name] = float(np.corrcoef(col, y)[0, 1])
    return sorted(ics.items(), key=lambda kv: abs(kv[1]), reverse=True)[:n]


def bar(val: float, width: int = 20) -> str:
    filled = int(abs(val) * width)
    return ("█" * filled).ljust(width)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, choices=["BTC", "ETH"])
    parser.add_argument("--alpha", type=float, default=10.0)
    parser.add_argument(
        "--horizons", type=int, nargs="+", default=[24, 48, 72, 168],
        help="Horizons to compare (hours). Must exist in the training CSV.",
    )
    args = parser.parse_args()

    feat_names = all_feature_names()
    print(f"\nHorizon comparison — {args.asset}  alpha={args.alpha}  features={len(feat_names)}")
    print("=" * 80)

    csv_path = REPO_ROOT / "packages" / "pipeline" / "training" / f"snapshot_training_{args.asset.lower()}.csv"
    if not csv_path.exists():
        sys.exit(f"CSV not found: {csv_path}\nRun: pnpm ml:gen-training-data")

    df_all = pd.read_csv(csv_path)
    print(f"Total CSV rows: {len(df_all)}")
    print(f"Available horizons: {sorted(df_all['horizon_hours'].unique().tolist())}\n")

    results = []
    for horizon in sorted(args.horizons):
        df = df_all[df_all["horizon_hours"] == horizon].copy()
        if len(df) < 30:
            print(f"  {horizon:>4}h  — skipped (only {len(df)} rows)")
            results.append({"horizon": horizon, "error": f"only {len(df)} rows"})
            continue

        for col in feat_names:
            if col not in df.columns:
                df[col] = 0.0
        df[feat_names] = df[feat_names].fillna(0.0)
        df = df.dropna(subset=["return_pct"])

        y_raw = df["return_pct"].to_numpy(dtype=np.float64)
        q_std = float(y_raw.std())
        y = np.clip(y_raw / (3.0 * q_std), -1.0, 1.0).astype(np.float64)
        X = df[feat_names].to_numpy(dtype=np.float32)

        cv = run_cv(X, y, args.alpha, df["timestamp"])
        if "error" in cv:
            print(f"  {horizon:>4}h  — {cv['error']}")
            results.append({"horizon": horizon, **cv})
            continue

        top = top_features(X, y, feat_names, n=3)
        cv["horizon"] = horizon
        cv["top_features"] = top
        results.append(cv)

    # ── Summary table ──────────────────────────────────────────────────────────
    valid = [r for r in results if "pearson_ic" in r]
    if not valid:
        print("\nNo horizons with enough data.")
        return

    print("\n" + "─" * 90)
    print(f"  {'Horizon':>8}  {'N':>5}  {'OOF IC':>8}  {'In-samp':>8}  {'Gap':>6}  {'Spearman':>9}  {'Hit%':>6}  {'p-val':>7}")
    print("─" * 90)
    for r in sorted(valid, key=lambda x: x["pearson_ic"], reverse=True):
        sig = "***" if r["p_value"] < 0.001 else ("** " if r["p_value"] < 0.01 else ("*  " if r["p_value"] < 0.05 else "   "))
        gap = r["insample_ic"] - r["pearson_ic"]
        gap_flag = " ⚠" if gap > 0.3 else ""
        print(
            f"  {r['horizon']:>6}h  "
            f"{r['n']:>5}  "
            f"{r['pearson_ic']:>+8.3f}  "
            f"{r['insample_ic']:>+8.3f}  "
            f"{gap:>+6.3f}{gap_flag}  "
            f"{r['spearman_ic']:>+9.3f}  "
            f"{r['hit_rate']*100:>5.1f}%  "
            f"{r['p_value']:>7.4f}{sig}"
        )
    print("─" * 90)
    print("  (Gap = in-sample IC − OOF IC. Large gap → overfitting. ⚠ = gap > 0.3)")

    best = max(valid, key=lambda x: x["pearson_ic"])
    print(f"\n  Best horizon: {best['horizon']}h  (OOF IC={best['pearson_ic']:+.3f})")

    print("\n  Per-fold IC (consistency check — one bad fold = regime fluke):")
    for r in sorted(valid, key=lambda x: x["horizon"]):
        folds_str = "  ".join(
            f"{f['period']}:{f['ic']:>+.2f}(n={f['n']})"
            for f in r.get("fold_ics", [])
        )
        print(f"    {r['horizon']:>4}h  {folds_str}")

    print("\n  Top features per horizon:")
    for r in sorted(valid, key=lambda x: x["horizon"]):
        if "top_features" in r:
            feats = "  |  ".join(f"{name.split('_', 1)[1]} ({ic:+.3f})" for name, ic in r["top_features"])
            print(f"    {r['horizon']:>4}h: {feats}")

    print()


if __name__ == "__main__":
    main()
