/**
 * Debug script — isolates the funding pressure calculation.
 *
 * Shows the full funding distribution, thresholds, and how many
 * consecutive extreme-side cycles are counted with/without OI gating.
 *
 * Usage:  tsx src/scripts/debug-funding-pressure.ts [BTC|ETH]
 */

import "../env.js";
import { collect } from "../derivatives_structure/collector.js";
import { analyze } from "../derivatives_structure/analyzer.js";
import type { AssetType, DerivativesState, TimestampedValue } from "../types.js";
import fs from "node:fs";
import path from "node:path";

// ─── helpers ─────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function percentileValue(sorted: number[], p: number): number {
  return sorted[Math.floor(sorted.length * p)]!;
}

function zScore(values: number[], current: number): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (current - mean) / std : 0;
}

function sparkline(values: number[], med: number): string {
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (blocks.length - 1));
      const char = blocks[idx]!;
      return v > med ? `\x1b[32m${char}\x1b[0m` : `\x1b[31m${char}\x1b[0m`;
    })
    .join("");
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
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as AssetType;
  console.log(`\n🔍 Funding pressure debug — ${asset}\n`);

  // 1. Collect derivatives data
  console.log("Fetching derivatives data...\n");
  const snapshot = await collect(asset);
  const prevState = loadDimState<DerivativesState>("derivatives_state.json", asset);
  const { context } = analyze(snapshot, prevState);

  const fundingHistory = snapshot.funding.history1m;
  const values = fundingHistory.map((h) => h.value);
  const sorted = [...values].sort((a, b) => a - b);

  // 2. Distribution stats
  const med = median(sorted);
  const q25 = percentileValue(sorted, 0.25);
  const q75 = percentileValue(sorted, 0.75);
  const iqr = q75 - q25;

  console.log("─── Funding distribution (30d) ───────────────────");
  console.log(`  Data points             : ${values.length} (8h intervals)`);
  console.log(`  Min                     : ${values.length ? Math.min(...values).toFixed(4) : "—"}%`);
  console.log(`  Q25 (lower thresh)      : ${q25.toFixed(4)}%`);
  console.log(`  Median                  : ${med.toFixed(4)}%`);
  console.log(`  Q75 (upper thresh)      : ${q75.toFixed(4)}%`);
  console.log(`  Max                     : ${values.length ? Math.max(...values).toFixed(4) : "—"}%`);
  console.log(`  IQR                     : ${iqr.toFixed(4)}%`);
  console.log(`  Current                 : ${snapshot.funding.current.toFixed(4)}%`);
  console.log(`  Current percentile      : ${context.signals.fundingPct1m}th`);

  // 3. OI context
  const oiValues = snapshot.openInterest.history1m.map((h) => h.value);
  const oiZ = zScore(oiValues, snapshot.openInterest.current);

  console.log("\n─── OI context ───────────────────────────────────");
  console.log(`  Current OI              : $${(snapshot.openInterest.current / 1e9).toFixed(2)}B`);
  console.log(`  OI Z-Score (30d)        : ${oiZ.toFixed(2)}`);
  console.log(`  OI elevated (z > 0.5)   : ${oiZ > 0.5 ? "YES ✓" : "NO ✗"}`);

  // 4. Pressure calculation — step by step
  console.log("\n─── Pressure calculation ─────────────────────────");

  const latest = values[values.length - 1]!;
  const aboveUpper = latest > q75;
  const belowLower = latest < q25;

  console.log(`  Latest funding cycle    : ${latest.toFixed(4)}%`);
  console.log(`  Above Q75 (${q75.toFixed(4)})    : ${aboveUpper ? "YES → LONG side" : "NO"}`);
  console.log(`  Below Q25 (${q25.toFixed(4)})    : ${belowLower ? "YES → SHORT side" : "NO"}`);

  if (!aboveUpper && !belowLower) {
    console.log(`  → Latest cycle is NOT extreme. Pressure = 0`);
  } else {
    const side = aboveUpper ? "LONG" : "SHORT";
    const isOnSide = side === "LONG"
      ? (v: number) => v > med
      : (v: number) => v < med;

    // Count without OI gate (raw cycles)
    let rawCycles = 0;
    for (let i = values.length - 1; i >= 0; i--) {
      if (isOnSide(values[i]!)) rawCycles++;
      else break;
    }

    const effectiveCycles = oiZ > 0.5 ? rawCycles : 0;

    console.log(`  Side                    : ${side}`);
    console.log(`  Continuation test       : ${side === "LONG" ? `> median (${med.toFixed(4)})` : `< median (${med.toFixed(4)})`}`);
    console.log(`  Raw consecutive cycles  : ${rawCycles} (${(rawCycles * 8)}h)`);
    console.log(`  OI gate applied         : ${oiZ > 0.5 ? `NO (OI elevated)` : `YES → zeroed out`}`);
    console.log(`  Final pressure cycles   : ${effectiveCycles}`);

    // Show the last N cycles with markers
    console.log(`\n─── Last ${Math.min(20, values.length)} funding cycles ──────────────────────`);
    const tail = fundingHistory.slice(-20);
    for (const entry of tail) {
      const v = entry.value;
      const ts = new Date(entry.timestamp).toISOString().slice(5, 16).replace("T", " ");
      const bar = "█".repeat(Math.min(40, Math.round(Math.abs(v) * 1000)));
      const marker =
        v > q75 ? " ◀ EXTREME LONG" :
        v < q25 ? " ◀ EXTREME SHORT" :
        v > med ? " ▸ above median" :
        v < med ? " ▸ below median" : "";
      const color = v > med ? "\x1b[32m" : "\x1b[31m";
      console.log(`  ${ts}  ${color}${v >= 0 ? "+" : ""}${v.toFixed(4)}%\x1b[0m  ${color}${bar}\x1b[0m${marker}`);
    }
  }

  // 5. Sparkline of full history
  console.log("\n─── Funding history sparkline ─────────────────────");
  console.log(`  ${sparkline(values, med)}`);
  console.log(`  \x1b[32m■\x1b[0m above median  \x1b[31m■\x1b[0m below median`);

  // 6. Result from analyzer
  console.log("\n─── Analyzer output ──────────────────────────────");
  console.log(`  fundingPressureCycles   : ${context.signals.fundingPressureCycles}`);
  console.log(`  fundingPressureSide     : ${context.signals.fundingPressureSide ?? "—"}`);
  console.log(`  Positioning             : ${context.positioning.state}`);
  console.log(`  Stress                  : ${context.stress.state}`);

  // 7. Sensitivity — what if OI z-score were different?
  console.log("\n─── Sensitivity: pressure at different OI z-scores ─");
  const zScores = [0.0, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0];
  console.log(`  ${"z-score".padEnd(12)}${"OI gated?".padEnd(14)}Cycles`);
  console.log("  " + "─".repeat(36));
  for (const z of zScores) {
    const gated = z <= 0.5;
    const marker = Math.abs(z - oiZ) < 0.05 ? " ◀ current" : "";
    // Raw cycles don't change, only the gate
    const aboveUp = latest > q75;
    const belowLow = latest < q25;
    let raw = 0;
    if (aboveUp || belowLow) {
      const s = aboveUp ? "LONG" : "SHORT";
      const test = s === "LONG" ? (v: number) => v > med : (v: number) => v < med;
      for (let i = values.length - 1; i >= 0; i--) {
        if (test(values[i]!)) raw++;
        else break;
      }
    }
    console.log(`  ${z.toFixed(1).padEnd(12)}${(gated ? "YES → 0" : "NO").padEnd(14)}${gated ? 0 : raw}${marker}`);
  }

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
