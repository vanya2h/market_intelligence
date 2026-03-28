#!/usr/bin/env tsx
/**
 * Debug script — sanity-check Volume Profile / POC implementation.
 *
 * Fetches live futures candles from Binance, runs the VP computation,
 * and prints a visual ASCII profile + key levels for manual inspection.
 *
 * Usage:
 *   npx tsx src/htf/debug-vp.bin.ts
 *   npx tsx src/htf/debug-vp.bin.ts --asset ETH
 */

import "../env.js";
import { collect } from "./collector.js";
import { analyze } from "./analyzer.js";
import type { VolumeProfileResult } from "./types.js";

const asset = process.argv.includes("--asset")
  ? (process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH")
  : "BTC";

async function main() {
  console.log(`\n  Fetching ${asset} data from Binance...\n`);
  const snapshot = await collect(asset);
  const { context } = analyze(snapshot, null);

  const { volumeProfile, price, atr } = context;
  const vp = volumeProfile.profile;

  // ─── Key levels ──────────────────────────────────────────────────────────
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  VOLUME PROFILE DEBUG                              │");
  console.log("  ├─────────────────────────────────────────────────────┤");
  console.log(`  │  Asset:              ${asset}`);
  console.log(`  │  Current price:      $${price.toLocaleString()}`);
  console.log(`  │  ATR-14 (4h):        $${atr.toLocaleString()}`);
  console.log(`  │  Range start:        ${volumeProfile.rangeStartCandles} candles back (~${(volumeProfile.rangeStartCandles * 4 / 24).toFixed(1)} days)`);
  console.log("  │");
  console.log(`  │  POC:                $${vp.poc.toLocaleString()}  (${vp.pocVolumePct.toFixed(1)}% of volume)`);
  console.log(`  │  VA High:            $${vp.vaHigh.toLocaleString()}`);
  console.log(`  │  VA Low:             $${vp.vaLow.toLocaleString()}`);
  console.log(`  │  VA Width:           $${(vp.vaHigh - vp.vaLow).toLocaleString()} (${((vp.vaHigh - vp.vaLow) / vp.poc * 100).toFixed(2)}%)`);
  console.log(`  │  Price vs POC:       ${vp.priceVsPocPct >= 0 ? "+" : ""}${vp.priceVsPocPct.toFixed(2)}%`);
  console.log(`  │  Price position:     ${vp.pricePosition}`);
  console.log("  │");
  console.log(`  │  HVNs (magnets):     ${vp.hvns.length > 0 ? vp.hvns.map(h => `$${h.toLocaleString()}`).join(", ") : "(none)"}`);
  console.log(`  │  LVNs (accel zones): ${vp.lvns.length > 0 ? vp.lvns.map(l => `$${l.toLocaleString()}`).join(", ") : "(none)"}`);
  console.log("  └─────────────────────────────────────────────────────┘");

  // ─── Composite target comparison ─────────────────────────────────────────
  console.log("\n  ── Composite Target Levels ──────────────────────────");
  console.log(`  │  SMA 50:             $${context.ma.sma50.toLocaleString()}`);
  console.log(`  │  SMA 200:            $${context.ma.sma200.toLocaleString()}`);
  console.log(`  │  VWAP weekly:        $${context.vwap.weekly.toLocaleString()}`);
  console.log(`  │  VWAP monthly:       $${context.vwap.monthly.toLocaleString()}`);
  console.log(`  │  POC:                $${vp.poc.toLocaleString()}  ← NEW`);

  // ─── ASCII volume profile ────────────────────────────────────────────────
  printAsciiProfile(vp, price);
}

/**
 * Render a sideways ASCII volume profile with key levels annotated.
 */
function printAsciiProfile(vp: VolumeProfileResult, currentPrice: number) {
  // Reconstruct a simplified histogram from the levels we have
  // We'll show the VA range with POC, HVNs, LVNs, and price marked
  const allPrices = [vp.poc, vp.vaHigh, vp.vaLow, currentPrice, ...vp.hvns, ...vp.lvns]
    .filter(p => p > 0)
    .sort((a, b) => b - a); // descending

  if (allPrices.length < 2) return;

  const maxPrice = Math.max(...allPrices) * 1.005;
  const minPrice = Math.min(...allPrices) * 0.995;
  const rows = 25;
  const step = (maxPrice - minPrice) / rows;
  const BAR_WIDTH = 40;

  console.log("\n  ── Visual Profile ──────────────────────────────────────────");
  console.log(`  Price range: $${minPrice.toFixed(0)} – $${maxPrice.toFixed(0)}\n`);

  for (let i = 0; i < rows; i++) {
    const rowHigh = maxPrice - i * step;
    const rowLow = rowHigh - step;
    const rowMid = (rowHigh + rowLow) / 2;

    // Determine if this row is inside VA
    const inVA = rowMid >= vp.vaLow && rowMid <= vp.vaHigh;

    // Bar length: full if near POC, proportional within VA, thin outside
    let barLen: number;
    const distFromPoc = Math.abs(rowMid - vp.poc) / step;
    if (distFromPoc < 1) {
      barLen = BAR_WIDTH; // POC row
    } else if (inVA) {
      barLen = Math.max(6, Math.round(BAR_WIDTH * 0.7 * (1 - distFromPoc / (rows / 2))));
    } else {
      barLen = Math.max(2, Math.round(BAR_WIDTH * 0.2 * (1 - distFromPoc / rows)));
    }

    // Check for HVN/LVN near this row
    const isHvn = vp.hvns.some(h => Math.abs(h - rowMid) < step);
    const isLvn = vp.lvns.some(l => Math.abs(l - rowMid) < step);

    const barChar = isLvn ? "·" : inVA ? "█" : "░";
    const bar = barChar.repeat(barLen);

    // Annotations
    const markers: string[] = [];
    if (Math.abs(rowMid - vp.poc) < step) markers.push("◄ POC");
    if (Math.abs(rowMid - currentPrice) < step) markers.push("◄ PRICE");
    if (Math.abs(rowMid - vp.vaHigh) < step) markers.push("◄ VA High");
    if (Math.abs(rowMid - vp.vaLow) < step) markers.push("◄ VA Low");
    if (isHvn) markers.push("◄ HVN");
    if (isLvn) markers.push("◄ LVN");

    const priceLabel = `$${rowMid.toFixed(0).padStart(7)}`;
    console.log(`  ${priceLabel} │${bar.padEnd(BAR_WIDTH)}│ ${markers.join(" ")}`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
