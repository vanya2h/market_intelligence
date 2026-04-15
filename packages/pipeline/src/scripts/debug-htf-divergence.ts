/**
 * Debug script — HTF divergence detection inspection.
 *
 * Prints every swing pivot, per-indicator divergence (with magnitude),
 * and the final confluence score. ISO timestamps are included so pivots
 * can be cross-checked against a live TradingView chart.
 *
 * Usage:
 *   tsx src/scripts/debug-htf-divergence.ts [BTC|ETH]
 *   pnpm debug:htf-divergence BTC
 *   pnpm debug:htf-divergence ETH
 */

import "../env.js";
import chalk from "chalk";
import { collect } from "../htf/collector.js";
import {
  buildCvdCurve,
  computeDivergenceConfluence,
  detectIndicatorDivergence,
  detectMfiDivergence,
  detectRsiDivergence,
  mfi14Curve,
  rsi14Curve,
  swingHighs,
  swingLows,
} from "../htf/analyzer.js";
import type { Candle, CvdDivergence } from "../htf/types.js";
import type { AssetType } from "../types.js";

const DIV_LOOKBACK = 14;
const CVD_LONG_LOOKBACK = 75;

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function hdr(title: string): void {
  console.log(`\n${chalk.bold.cyan("═══ " + title + " " + "═".repeat(Math.max(0, 56 - title.length)))}`);
}

function sub(title: string): void {
  console.log(`\n${chalk.dim("─── " + title + " " + "─".repeat(Math.max(0, 52 - title.length)))}`);
}

function printPivots(
  label: string,
  pivots: { index: number; value: number }[],
  times: number[],
  priceFormat = false,
): void {
  if (pivots.length === 0) {
    console.log(`  ${chalk.dim(label.padEnd(24))}${chalk.dim("(none)")}`);
    return;
  }
  console.log(`  ${chalk.white(label)}  (${pivots.length} pivots)`);
  // Show last 6 pivots for readability
  const recent = pivots.slice(-6);
  for (const p of recent) {
    const v = priceFormat ? `$${p.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : p.value.toFixed(2);
    const t = times[p.index] !== undefined ? fmtTime(times[p.index]!) : "?";
    console.log(`    idx ${String(p.index).padStart(3)}  ${t}  ${v}`);
  }
  if (pivots.length > 6) {
    console.log(`    ${chalk.dim(`... and ${pivots.length - 6} earlier`)}`);
  }
}

function divergenceLine(
  label: string,
  direction: string,
  magnitude: number,
  color = true,
): void {
  const col =
    direction === "BULLISH" ? chalk.green :
    direction === "BEARISH" ? chalk.red :
    chalk.dim;
  const magStr = magnitude > 0 ? `  magnitude ${magnitude.toFixed(3)}` : "";
  console.log(`  ${chalk.white(label.padEnd(20))}${color ? col(direction.padEnd(8)) : direction.padEnd(8)}${magStr}`);
}

async function runAsset(asset: AssetType): Promise<void> {
  hdr(`${asset} — HTF Divergence Debug`);

  const snapshot = await collect(asset);
  const h4 = snapshot.h4Candles;
  const h4Times = h4.map((c: Candle) => c.time);
  const currentPrice = h4.at(-1)!.close;
  const currentTime = h4.at(-1)!.time;

  console.log(`  ${chalk.dim("timestamp")}       ${fmtTime(currentTime)}`);
  console.log(`  ${chalk.dim("price")}           $${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  console.log(`  ${chalk.dim("4h candles")}      ${h4.length}`);

  // ─── RSI + MFI current values + curves ─────────────────────────────────────
  sub("Current indicator values");
  const rsiCurve = rsi14Curve(h4.map((c) => c.close));
  const mfiCurve = mfi14Curve(h4);
  const rsiNow = rsiCurve.at(-1)!;
  const mfiNow = mfiCurve.at(-1)!;
  console.log(`  ${chalk.dim("RSI-14 (4h)")}     ${rsiNow.toFixed(2)}`);
  console.log(`  ${chalk.dim("MFI-14 (4h)")}     ${mfiNow.toFixed(2)}`);
  const disagreement = Math.abs(rsiNow - mfiNow);
  if (disagreement >= 10) {
    console.log(
      `  ${chalk.yellow("⚠ RSI/MFI disagreement:")} ${disagreement.toFixed(1)} points — `
      + `volume ${mfiNow > rsiNow ? "ahead of" : "behind"} price momentum`,
    );
  }

  // ─── Swing pivots on price ────────────────────────────────────────────────
  sub("Price swing pivots (4h, lookback=14)");
  const priceHighs = swingHighs(h4.map((c) => c.high), DIV_LOOKBACK);
  const priceLows = swingLows(h4.map((c) => c.low), DIV_LOOKBACK);
  printPivots("price swing HIGHS", priceHighs, h4Times, true);
  printPivots("price swing LOWS", priceLows, h4Times, true);

  // ─── Swing pivots on RSI/MFI curves ───────────────────────────────────────
  sub("Indicator swing pivots (lookback=14)");
  const rsiHighs = swingHighs(rsiCurve, DIV_LOOKBACK);
  const rsiLows = swingLows(rsiCurve, DIV_LOOKBACK);
  const mfiHighs = swingHighs(mfiCurve, DIV_LOOKBACK);
  const mfiLows = swingLows(mfiCurve, DIV_LOOKBACK);
  printPivots("RSI swing HIGHS", rsiHighs, h4Times);
  printPivots("RSI swing LOWS", rsiLows, h4Times);
  printPivots("MFI swing HIGHS", mfiHighs, h4Times);
  printPivots("MFI swing LOWS", mfiLows, h4Times);

  // ─── Swing pivots on CVD curves ───────────────────────────────────────────
  sub("CVD swing pivots (long window, lookback=5)");
  const futLongSlice = snapshot.futuresH4Candles.slice(-CVD_LONG_LOOKBACK);
  const futCvdCurve = buildCvdCurve(futLongSlice);
  const spotLongSlice = h4.slice(-CVD_LONG_LOOKBACK);
  const spotCvdCurve = buildCvdCurve(spotLongSlice);
  const futTimes = futLongSlice.map((c: Candle) => c.time);
  const spotTimes = spotLongSlice.map((c: Candle) => c.time);
  printPivots("futures CVD HIGHS", swingHighs(futCvdCurve, 5), futTimes);
  printPivots("futures CVD LOWS", swingLows(futCvdCurve, 5), futTimes);
  printPivots("spot CVD HIGHS", swingHighs(spotCvdCurve, 5), spotTimes);
  printPivots("spot CVD LOWS", swingLows(spotCvdCurve, 5), spotTimes);

  // ─── Per-indicator divergences ────────────────────────────────────────────
  sub("Per-indicator divergences");
  const mfiDiv = detectMfiDivergence(h4);
  const rsiDiv = detectRsiDivergence(h4);

  // CVD divergences: analyze function detects these via existing detectDivergence,
  // we replicate here (analyzer's detectDivergence isn't exported).
  // Instead, use the generic sampling via cvdDivergenceMagnitude but we also need direction.
  // Call the sampler directly by passing a placeholder direction of each sign — simpler: run
  // a minimal check by reusing our generic detectIndicatorDivergence pattern on CVD curves.
  // For the debug script we'll reach into snapshot-based magnitudes by trying both directions.
  // Cleanest: take direction from the analyzer pipeline. We can just re-run analyze below
  // to get the final values.
  // For now, print the MFI/RSI signals here:
  divergenceLine("MFI (4h)", mfiDiv.direction, mfiDiv.magnitude);
  divergenceLine("RSI (4h)", rsiDiv.direction, rsiDiv.magnitude);

  // For CVD, probe with detectIndicatorDivergence directly (unbounded, price-pivot-anchored).
  // This gives us the same view the confluence scorer uses, without relying on the pipeline's
  // authoritative mechanism-aware detector. Absorption-only divergences won't show here — those
  // are caught by the main analyzer and get a conservative magnitude fallback.
  const cvdFutRes = detectIndicatorDivergence(futLongSlice, futCvdCurve, "unbounded");
  const cvdSpotRes = detectIndicatorDivergence(spotLongSlice, spotCvdCurve, "unbounded");
  const cvdFutDir: CvdDivergence = cvdFutRes.direction;
  const cvdFutMag = cvdFutRes.magnitude;
  const cvdSpotDir: CvdDivergence = cvdSpotRes.direction;
  const cvdSpotMag = cvdSpotRes.magnitude;

  divergenceLine("CVD futures", cvdFutDir, cvdFutMag);
  divergenceLine("CVD spot", cvdSpotDir, cvdSpotMag);

  // ─── Confluence ───────────────────────────────────────────────────────────
  sub("Divergence confluence (magnitude-weighted)");
  const confluence = computeDivergenceConfluence(
    mfiDiv,
    rsiDiv,
    { direction: cvdFutDir, magnitude: cvdFutMag },
    { direction: cvdSpotDir, magnitude: cvdSpotMag },
  );

  const dirColor =
    confluence.direction === "BULLISH" ? chalk.green.bold :
    confluence.direction === "BEARISH" ? chalk.red.bold :
    chalk.dim;
  console.log(`  ${chalk.white("direction")}        ${dirColor(confluence.direction)}`);
  console.log(`  ${chalk.white("strength")}         ${confluence.strength.toFixed(3)}`);
  console.log(`  ${chalk.white("sources")}          ${confluence.sources.length} contributing`);
  for (const s of confluence.sources) {
    const w = ({ mfi: 1.3, cvd_futures: 1.1, rsi: 0.8, cvd_spot: 0.7 } as const)[s.indicator];
    const weighted = (s.magnitude * w).toFixed(3);
    console.log(`    · ${chalk.cyan(s.indicator.padEnd(12))}  mag ${s.magnitude.toFixed(3)}  ×  w ${w}  =  ${weighted}`);
  }

  // ─── TradingView verification hints ───────────────────────────────────────
  sub("TradingView verification");
  console.log(`  symbol:      BINANCE:${asset}USDT`);
  console.log(`  timeframe:   4h (240)`);
  console.log(`  indicators:  Relative Strength Index, Money Flow Index`);
  if (confluence.direction !== "NONE") {
    // Use the first source's last pivot as a reference time
    console.log(`  ${chalk.yellow("check divergence visible on chart near:")} ${fmtTime(h4Times.at(-1)!)}`);
  }
}

async function main() {
  const assets = (process.argv.slice(2).filter((a) => a === "BTC" || a === "ETH") as AssetType[]);
  const list: AssetType[] = assets.length > 0 ? assets : ["BTC", "ETH"];
  for (const a of list) {
    await runAsset(a);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
