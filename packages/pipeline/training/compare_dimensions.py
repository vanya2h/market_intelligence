#!/usr/bin/env python3
"""
Compare snapshot model OOF IC across all 15 non-empty subsets of dimensions.

Dimensions are pre-defined feature groups — no individual feature fishing,
so no look-ahead bias from the search itself. Worst case is mild model-selection
bias from picking the best of 15 combinations; worth noting when interpreting results.

Usage:
  python compare_dimensions.py --asset BTC
  python compare_dimensions.py --asset BTC --horizon 168 --alpha 10
"""
import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from scipy import stats
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

SCHEMA_PATH = Path(__file__).parent / "feature_schema.json"
with open(SCHEMA_PATH) as f:
    FEATURE_SCHEMA = json.load(f)

ALL_DIMS = ["DERIVATIVES", "ETFS", "HTF", "EXCHANGE_FLOWS"]
DIM_SHORT = {"DERIVATIVES": "Deriv", "ETFS": "ETFs", "HTF": "HTF", "EXCHANGE_FLOWS": "EF"}


def feature_names_for_dims(dims: list[str]) -> list[str]:
    names = []
    for dim in dims:
        fs = FEATURE_SCHEMA["feature_sets"][dim]
        keys = list(fs.get("numeric", []))
        keys += [c["key"] for c in fs.get("categorical", [])]
        keys += [b["key"] for b in fs.get("boolean", [])]
        names.extend([f"{dim}_{k}" for k in keys])
    return names


def run_cv(X: np.ndarray, y: np.ndarray, alpha: float, timestamps: pd.Series) -> dict:
    n = len(X)
    if n < 60:
        return {"error": f"only {n} rows"}
    n_splits = min(5, max(2, n // 40))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    oof_pred = np.full(n, np.nan)
    fold_ics = []
    for tr, te in tscv.split(X):
        reg = Ridge(alpha=alpha)
        reg.fit(X[tr], y[tr])
        pred = reg.predict(X[te])
        oof_pred[te] = pred
        ic = float(np.corrcoef(y[te], pred)[0, 1]) if y[te].std() > 0 and pred.std() > 0 else 0.0
        fold_ics.append(ic)

    valid = ~np.isnan(oof_pred)
    if valid.sum() < 10:
        return {"error": "insufficient OOF predictions"}
    yv, pv = y[valid], oof_pred[valid]

    oof_ic = float(np.corrcoef(yv, pv)[0, 1]) if yv.std() > 0 and pv.std() > 0 else 0.0
    sp_ic = float(stats.spearmanr(yv, pv).statistic) if yv.std() > 0 else 0.0
    _, p_val = stats.pearsonr(yv, pv) if yv.std() > 0 and pv.std() > 0 else (0.0, 1.0)
    hit = float((np.sign(yv[yv != 0]) == np.sign(pv[yv != 0])).mean()) if (yv != 0).sum() > 0 else float("nan")

    reg_full = Ridge(alpha=alpha)
    reg_full.fit(X, y)
    ins_ic = float(np.corrcoef(y, reg_full.predict(X))[0, 1])

    return {
        "n": int(valid.sum()),
        "n_features": X.shape[1],
        "oof_ic": oof_ic,
        "spearman_ic": sp_ic,
        "insample_ic": ins_ic,
        "gap": ins_ic - oof_ic,
        "p_value": float(p_val),
        "hit_rate": hit,
        "fold_ics": fold_ics,
        "n_splits": n_splits,
    }


def dim_label(dims: list[str]) -> str:
    return "+".join(DIM_SHORT[d] for d in dims)


def bar(val: float, width: int = 16) -> str:
    sign = "+" if val >= 0 else "-"
    filled = int(abs(val) * width)
    return sign + "█" * filled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True, choices=["BTC", "ETH"])
    parser.add_argument("--horizon", type=int, default=168)
    parser.add_argument("--alpha", type=float, default=10.0)
    args = parser.parse_args()

    print(f"\nDimension search — {args.asset}  horizon={args.horizon}h  alpha={args.alpha}")
    print("=" * 80)

    csv_path = REPO_ROOT / "packages" / "pipeline" / "training" / f"snapshot_training_{args.asset.lower()}.csv"
    if not csv_path.exists():
        sys.exit(f"CSV not found: {csv_path}\nRun: pnpm ml:gen-training-data")

    df_all = pd.read_csv(csv_path)
    df_base = df_all[df_all["horizon_hours"] == args.horizon].copy()
    df_base = df_base.dropna(subset=["return_pct"])
    print(f"Rows at {args.horizon}h: {len(df_base)}\n")

    y_raw = df_base["return_pct"].to_numpy(np.float64)
    q_std = float(y_raw.std())
    y = np.clip(y_raw / (3.0 * q_std), -1.0, 1.0).astype(np.float64)

    # All non-empty subsets of ALL_DIMS, ordered by size then alphabetically
    all_subsets = []
    for size in range(1, len(ALL_DIMS) + 1):
        for combo in combinations(ALL_DIMS, size):
            all_subsets.append(list(combo))

    results = []
    for dims in all_subsets:
        feat_names = feature_names_for_dims(dims)
        df = df_base.copy()
        for col in feat_names:
            if col not in df.columns:
                df[col] = 0.0
        df[feat_names] = df[feat_names].fillna(0.0)

        X = df[feat_names].to_numpy(np.float32)
        cv = run_cv(X, y, args.alpha, df["timestamp"])
        if "error" in cv:
            cv["dims"] = dims
            cv["label"] = dim_label(dims)
            results.append(cv)
            continue

        cv["dims"] = dims
        cv["label"] = dim_label(dims)
        results.append(cv)

    # Sort by OOF IC descending
    valid = [r for r in results if "oof_ic" in r]
    errors = [r for r in results if "error" in r]

    valid.sort(key=lambda r: r["oof_ic"], reverse=True)

    print(f"  {'Dimensions':<22}  {'Feats':>5}  {'OOF IC':>8}  {'In-samp':>8}  {'Gap':>7}  {'Hit%':>5}  {'p-val':>7}  Bar")
    print("─" * 95)
    for r in valid:
        sig = "***" if r["p_value"] < 0.001 else ("** " if r["p_value"] < 0.01 else ("*  " if r["p_value"] < 0.05 else "   "))
        gap_flag = "⚠" if r["gap"] > 0.3 else " "
        print(
            f"  {r['label']:<22}  "
            f"{r['n_features']:>5}  "
            f"{r['oof_ic']:>+8.3f}  "
            f"{r['insample_ic']:>+8.3f}  "
            f"{r['gap']:>+7.3f}{gap_flag}  "
            f"{r['hit_rate']*100:>4.1f}%  "
            f"{r['p_value']:>7.4f}{sig}  "
            f"{bar(r['oof_ic'])}"
        )

    if errors:
        print(f"\n  Skipped ({len(errors)} combos had too few rows):")
        for r in errors:
            print(f"    {r['label']}: {r.get('error')}")

    if valid:
        best = valid[0]
        print(f"\n  Best: {best['label']}  OOF IC={best['oof_ic']:+.3f}  gap={best['gap']:+.3f}")

        print(f"\n  Per-fold IC for top-3:")
        for r in valid[:3]:
            folds = "  ".join(f"{ic:+.2f}" for ic in r["fold_ics"])
            print(f"    {r['label']:<22}  folds: {folds}  (std={np.std(r['fold_ics']):.3f})")

    print()


if __name__ == "__main__":
    main()
