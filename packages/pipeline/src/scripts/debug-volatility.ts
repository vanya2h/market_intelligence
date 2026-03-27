/**
 * Debug script — isolates the volatility indicator calculation.
 *
 * Usage:  tsx src/scripts/debug-volatility.ts [BTC|ETH]
 */

import "../env.js";
import { collect as collectHtf } from "../htf/collector.js";
import { analyze as analyzeHtf } from "../htf/analyzer.js";
import type { HtfState } from "../htf/types.js";
import type { Candle } from "../htf/types.js";
import fs from "node:fs";
import path from "node:path";

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** ATR-14 using Wilder/RMA smoothing — matches PineScript ta.rma(ta.tr, 14) */
function atr14(candles: Candle[]): number {
  if (candles.length < 15) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const pc = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]!) / 14;
  }
  return parseFloat(atr.toFixed(2));
}

// ─── OLD scoring (prod) ─────────────────────────────────────────────────────

function scoreVolatilityOld(atrRatio: number, priceVsSma200Pct: number): number {
  if (atrRatio === 0) return 50;
  const compression = clamp((1 - atrRatio) * 100 + 50);
  if (priceVsSma200Pct > 0) {
    return clamp(50 + (compression - 50) * 0.6);
  } else {
    return clamp(50 - (compression - 50) * 0.6);
  }
}

// ─── NEW scoring ─────────────────────────────────────────────────────────────

function scoreVolatilityNew(atrRatio: number, priceVsSma200Pct: number): number {
  if (atrRatio === 0) return 50;

  // Compression/expansion as deviation from 1.0
  // ratio 0.6 → strong compression, ratio 1.4 → strong expansion
  // Map to magnitude 0–100 where 50 = neutral (ratio ~1.0)
  const magnitude = clamp(50 + (1 - atrRatio) * 100);

  // Use continuous SMA distance instead of binary above/below
  // Clamp distance to ±15% to avoid extreme outliers dominating
  const smaDistance = Math.max(-15, Math.min(15, priceVsSma200Pct));
  // Normalize to -1..+1
  const direction = smaDistance / 15;

  // Compressed + above SMA → greed (coiled spring, bullish)
  // Compressed + below SMA → fear  (coiled spring, bearish)
  // Expanded   + above SMA → neutral-greed (trend running)
  // Expanded   + below SMA → neutral-fear  (sell-off running)
  const deviation = magnitude - 50;
  return clamp(50 + deviation * direction);
}

// ─── state loader ────────────────────────────────────────────────────────────

function loadDimState<T>(file: string, asset: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  return (all[asset] ?? all) as T;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  console.log(`\n🔍 Volatility debug — ${asset}\n`);

  // 1. Collect HTF data
  console.log("Fetching HTF data...");
  const snapshot = await collectHtf(asset);
  const prevState = loadDimState<HtfState>("htf_state.json", asset);
  const { context } = analyzeHtf(snapshot, prevState);

  const daily = snapshot.dailyCandles;

  // 2. ATR values — same timeframe (daily/daily)
  const dailyAtrCurrent = atr14(daily);
  const dailyOlder = daily.slice(0, -30);
  const dailyAtr30dAgo = atr14(dailyOlder);
  const atrRatio = dailyAtr30dAgo > 0
    ? parseFloat((dailyAtrCurrent / dailyAtr30dAgo).toFixed(3))
    : 1;

  // 3. Bug: what prod currently computes (4h / daily)
  const buggyRatio = dailyAtr30dAgo > 0
    ? parseFloat((context.atr / dailyAtr30dAgo).toFixed(3))
    : 1;

  const sma200 = context.ma.priceVsSma200Pct;

  // 4. Scores
  const oldBuggy = scoreVolatilityOld(buggyRatio, sma200);
  const oldFixed = scoreVolatilityOld(atrRatio, sma200);
  const newFixed = scoreVolatilityNew(atrRatio, sma200);

  // 5. Print
  console.log("─── Raw inputs ───────────────────────────────────");
  console.log(`  Daily candles           : ${daily.length}`);
  console.log(`  Current price           : ${daily.at(-1)?.close}`);

  console.log("\n─── ATR-14 (daily) ───────────────────────────────");
  console.log(`  Current                 : ${dailyAtrCurrent}`);
  console.log(`  30d ago baseline        : ${dailyAtr30dAgo}`);
  console.log(`  Ratio (current/30d)     : ${atrRatio}`);
  console.log(`  ⚠ Prod buggy ratio      : ${buggyRatio}  (4h ATR ${context.atr} / daily ATR ${dailyAtr30dAgo})`);

  console.log("\n─── Price vs SMA ─────────────────────────────────");
  console.log(`  Price vs SMA-50         : ${context.ma.priceVsSma50Pct.toFixed(2)}%`);
  console.log(`  Price vs SMA-200        : ${sma200.toFixed(2)}%`);

  console.log("\n─── Score comparison ─────────────────────────────");
  const header = "  Method".padEnd(36) + "Ratio".padEnd(10) + "Score".padEnd(10) + "Label";
  console.log(header);
  console.log("  " + "─".repeat(64));
  for (const [label, ratio, score] of [
    ["⚠ Prod (old formula, buggy ratio)", buggyRatio, oldBuggy],
    ["Old formula, fixed ratio", atrRatio, oldFixed],
    ["New formula, fixed ratio", atrRatio, newFixed],
  ] as const) {
    const lbl = score < 25 ? "EXTREME FEAR" : score < 40 ? "FEAR" : score < 60 ? "NEUTRAL" : score < 75 ? "GREED" : "EXTREME GREED";
    console.log(`  ${label}`.padEnd(36) + `${ratio}`.padEnd(10) + `${score.toFixed(1)}`.padEnd(10) + lbl);
  }

  // 6. Sensitivity table for new formula
  console.log("\n─── New formula sensitivity ───────────────────────");
  console.log("  ATR ratio → score at different SMA-200 distances:");
  const ratios = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5];
  const smaDistances = [-10, -5, -1, 0, 1, 5, 10];
  let hdr = "  ratio  ";
  for (const d of smaDistances) hdr += `${d > 0 ? "+" : ""}${d}%`.padStart(7);
  console.log(hdr);
  console.log("  " + "─".repeat(7 + smaDistances.length * 7));
  for (const r of ratios) {
    let row = `  ${r.toFixed(1)}    `;
    for (const d of smaDistances) {
      row += `${scoreVolatilityNew(r, d).toFixed(0)}`.padStart(7);
    }
    console.log(row);
  }

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
