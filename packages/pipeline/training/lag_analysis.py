#!/usr/bin/env python3
"""
Signal lag analysis — Pearson IC and Spearman IC between the trend-strength
signal (confluence.total) and forward price returns at key horizons.

Answers: Does the signal lead price? By how many hours?
Outputs IC table for canonical horizons and a rolling IC chart across days.

Usage:
  python lag_analysis.py               # BTC
  python lag_analysis.py --asset ETH
  python lag_analysis.py --asset BTC --asset ETH  # both
  python lag_analysis.py --min-n 20    # minimum samples per bucket (default 30)
"""
import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from scipy import stats

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

# Key horizons to analyse (hours). The outcome checker stores every 1h,
# but only these have enough samples and represent meaningful trading windows.
KEY_HORIZONS = [4, 8, 12, 24, 48, 72, 96, 120, 144, 168, 240, 336, 504, 672]


def fetch_data(assets: list[str]) -> pd.DataFrame:
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

    placeholders = ",".join(["%s"] * len(assets))
    query = f"""
        SELECT
            ti."createdAt"                                AS ts,
            ti.asset,
            (ti.confluence->>'total')::float              AS signal,
            r."hoursAfter"                                AS hours_after,
            r."returnPct"                                 AS return_pct
        FROM trade_ideas ti
        JOIN trade_idea_returns r ON r."tradeIdeaId" = ti.id
        WHERE ti.asset IN ({placeholders})
          AND (ti.confluence->>'total') IS NOT NULL
          AND ti.direction IN ('LONG', 'SHORT')
        ORDER BY ti."createdAt" ASC, r."hoursAfter" ASC
    """

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, assets)
        rows = cur.fetchall()
    conn.close()

    return pd.DataFrame([dict(r) for r in rows])


def pearson_ic(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    if len(x) < 3:
        return float("nan"), float("nan")
    r, p = stats.pearsonr(x, y)
    return float(r), float(p)


def spearman_ic(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    if len(x) < 3:
        return float("nan"), float("nan")
    r, p = stats.spearmanr(x, y)
    return float(r), float(p)


def hit_rate(signal: np.ndarray, ret: np.ndarray) -> float:
    if len(signal) == 0:
        return float("nan")
    return float(np.mean(np.sign(signal) == np.sign(ret)))


def sig_stars(p: float) -> str:
    if np.isnan(p):
        return "   "
    if p < 0.01:
        return "***"
    if p < 0.05:
        return "** "
    if p < 0.1:
        return "*  "
    return "   "


def print_table(title: str, rows: list[dict]) -> None:
    if not rows:
        print(f"\n  {title}: no data\n")
        return

    header = (
        f"{'Lag':>8}  {'N':>5}  {'PearsonIC':>10}  {'sig':>3}  "
        f"{'SpearmanIC':>11}  {'HitRate':>8}  {'AvgRet%':>8}"
    )
    sep = "─" * len(header)
    print(f"\n  {title}")
    print(f"  {sep}")
    print(f"  {header}")
    print(f"  {sep}")
    for r in rows:
        lag = f"{r['hours_after']}h"
        pic = r["pearson_ic"]
        sic = r["spearman_ic"]
        hr = r["hit_rate"]
        avg_ret = r["avg_return_pct"]
        stars = sig_stars(r["p_value"])

        def fmt_ic(v: float) -> str:
            return f"{v:+.3f}" if not np.isnan(v) else "  —  "

        print(
            f"  {lag:>8}  {r['n']:>5}  {fmt_ic(pic):>10}  {stars:>3}  "
            f"{fmt_ic(sic):>11}  {f'{hr:.1%}':>8}  {f'{avg_ret:+.3f}':>8}"
        )
    print(f"  {sep}")
    print("  * p<0.1  ** p<0.05  *** p<0.01\n")


def rolling_ic_chart(sub: pd.DataFrame, asset: str, horizon: int = 24) -> None:
    """Print an ASCII chart of rolling monthly Pearson IC at the chosen horizon."""
    g = sub[sub["hours_after"] == horizon].copy()
    if len(g) < 6:
        print(f"  (Not enough data for rolling IC chart at {horizon}h)\n")
        return

    g["month"] = g["ts"].dt.to_period("M").astype(str)
    monthly = []
    for period, grp in g.groupby("month"):
        if len(grp) < 3:
            continue
        ic, _ = pearson_ic(grp["signal"].values, grp["return_pct"].values)
        monthly.append({"month": str(period), "ic": ic, "n": len(grp)})

    if not monthly:
        return

    # ASCII bar chart
    print(f"  Rolling monthly Pearson IC at {horizon}h horizon — {asset}")
    print(f"  {'Month':<10}  {'N':>4}  IC")
    print(f"  {'─'*50}")
    for m in monthly:
        ic = m["ic"]
        bar_len = int(abs(ic) * 20)
        if np.isnan(ic):
            bar = "  —"
        elif ic >= 0:
            bar = "  " + " " * 20 + "│" + "█" * bar_len + f"  +{ic:.2f}"
        else:
            bar = "  " + " " * (20 - bar_len) + "█" * bar_len + "│" + f"  {ic:.2f}"
        print(f"  {m['month']:<10}  {m['n']:>4}  {bar}")
    print()


def analyze(df: pd.DataFrame, asset: str, min_n: int) -> None:
    sub = df[df["asset"] == asset].dropna(subset=["signal", "return_pct"]).copy()
    sub["ts"] = pd.to_datetime(sub["ts"])

    if sub.empty:
        print(f"\n  No data for {asset}.\n")
        return

    total_ideas = sub.drop_duplicates(subset=["ts", "signal"]).shape[0]
    date_range = f"{sub['ts'].min().date()} → {sub['ts'].max().date()}"
    print(f"\n  Asset: {asset}  |  {total_ideas} trade ideas  |  {date_range}")

    rows = []
    for lag in KEY_HORIZONS:
        g = sub[sub["hours_after"] == lag]
        if len(g) < min_n:
            continue
        x = g["signal"].values
        y = g["return_pct"].values

        pic, pval = pearson_ic(x, y)
        sic, _ = spearman_ic(x, y)
        hr = hit_rate(x, y)
        rows.append({
            "hours_after": lag,
            "n": len(g),
            "pearson_ic": pic,
            "p_value": pval,
            "spearman_ic": sic,
            "hit_rate": hr,
            "avg_return_pct": float(y.mean()),
        })

    print_table(f"Signal IC vs forward returns  (min N={min_n})", rows)

    if rows:
        valid = [r for r in rows if not np.isnan(r["pearson_ic"])]
        if valid:
            best = max(valid, key=lambda r: abs(r["pearson_ic"]))
            print(
                f"  → Best Pearson IC at {best['hours_after']}h: "
                f"{best['pearson_ic']:+.3f} {sig_stars(best['p_value']).strip()}  "
                f"(hit rate {best['hit_rate']:.1%},  N={best['n']})"
            )
            # Interpretation
            ic = best["pearson_ic"]
            lag = best["hours_after"]
            if abs(ic) < 0.05:
                interp = "Signal has essentially no predictive power at any horizon."
            elif lag <= 24:
                interp = f"Signal is a SHORT-TERM indicator — peak correlation at {lag}h."
            elif lag <= 72:
                interp = f"Signal leads by ~{lag//24} day(s) — useful for swing entries."
            else:
                interp = f"Signal leads by ~{lag//24} days — useful for multi-day/week trends."
            print(f"  → Interpretation: {interp}\n")

    # Rolling chart at 24h and 168h
    for h in [24, 168]:
        if any(r["hours_after"] == h for r in rows):
            rolling_ic_chart(sub, asset, h)


def main() -> None:
    parser = argparse.ArgumentParser(description="Signal lag analysis vs forward returns")
    parser.add_argument("--asset", action="append", dest="assets", choices=["BTC", "ETH"], metavar="ASSET")
    parser.add_argument("--min-n", type=int, default=30, help="Min samples per horizon bucket (default 30)")
    args = parser.parse_args()

    assets: list[str] = args.assets or ["BTC"]

    print(f"\nSignal Lag Analysis")
    print(f"Assets     : {', '.join(assets)}")
    print(f"Signal     : confluence.total (trend strength ∈ [-1, +1])")
    print(f"Horizons   : {KEY_HORIZONS}")
    print(f"Min N      : {args.min_n}")

    df = fetch_data(assets)
    if df.empty:
        print("\nNo data found. Check that trade_ideas and trade_idea_returns have rows.")
        return

    print(f"Loaded     : {len(df):,} signal×lag pairs\n")

    for asset in assets:
        analyze(df, asset, args.min_n)


if __name__ == "__main__":
    main()
