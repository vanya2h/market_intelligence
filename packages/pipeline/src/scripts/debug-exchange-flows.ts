/**
 * Debug script — inspects raw exchange flow data and analyzer output.
 *
 * Usage:  tsx src/scripts/debug-exchange-flows.ts [BTC|ETH]
 */

import "../env.js";
import { collect } from "../exchange_flows/collector.js";
import { analyze } from "../exchange_flows/analyzer.js";
import type { ExchangeFlowsState } from "../exchange_flows/types.js";
import type { AssetType } from "../types.js";
import fs from "node:fs";
import path from "node:path";

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadDimState<T>(file: string, asset: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  return (all[asset] ?? all) as T;
}

function fmtAsset(v: number, asset: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : " ";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M ${asset}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${asset}`;
  return `${sign}${abs.toFixed(2)} ${asset}`;
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  return `$${abs.toFixed(0)}`;
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(3)}%`;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as AssetType;
  console.log(`\n🔍 Exchange Flows debug — ${asset}\n`);

  // 1. Collect
  console.log("Fetching exchange flow data...");
  const snapshot = await collect(asset);

  console.log("─── Raw snapshot ─────────────────────────────────");
  console.log(`  Timestamp               : ${snapshot.timestamp}`);
  console.log(`  Balance history points  : ${snapshot.balanceHistory.length}`);
  console.log(`  Exchanges tracked       : ${snapshot.currentBalances.length}`);
  console.log(`  Total balance           : ${fmtAsset(snapshot.totalBalance, asset)}`);
  console.log(`  Price                   : $${snapshot.priceUsd.toFixed(2)}`);

  // 2. Balance history summary
  const history = snapshot.balanceHistory;
  if (history.length > 0) {
    const first = history[0]!;
    const last = history.at(-1)!;
    const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const history30d = history.filter((p) => p.timestamp >= cutoff30d);
    const min = Math.min(...history30d.map((p) => p.totalBalance));
    const max = Math.max(...history30d.map((p) => p.totalBalance));
    const span = (last.timestamp - first.timestamp) / (1000 * 60 * 60 * 24);

    console.log("\n─── Balance history ──────────────────────────────");
    console.log(`  Total span              : ${span.toFixed(1)} days (${history.length} points)`);
    console.log(`  First                   : ${new Date(first.timestamp).toISOString().slice(0, 10)}  ${fmtAsset(first.totalBalance, asset)}`);
    console.log(`  Last                    : ${new Date(last.timestamp).toISOString().slice(0, 10)}  ${fmtAsset(last.totalBalance, asset)}`);
    console.log(`  30d window              : ${history30d.length} points`);
    console.log(`  30d min                 : ${fmtAsset(min, asset)}`);
    console.log(`  30d max                 : ${fmtAsset(max, asset)}`);
    console.log(`  30d range               : ${fmtAsset(max - min, asset)}`);

    // Last 7 data points
    console.log("\n  Last 7 data points:");
    const recent = history.slice(-7);
    for (let i = 0; i < recent.length; i++) {
      const p = recent[i]!;
      const prev = i > 0 ? recent[i - 1]! : history[history.length - 8] ?? p;
      const delta = p.totalBalance - prev.totalBalance;
      const date = new Date(p.timestamp).toISOString().slice(0, 10);
      console.log(`    ${date}  ${fmtAsset(p.totalBalance, asset).padEnd(20)}  Δ ${fmtAsset(delta, asset)}`);
    }
  }

  // 3. Top exchanges
  console.log("\n─── Top exchanges (by balance) ───────────────────");
  const top10 = snapshot.currentBalances.slice(0, 10);
  const hdr = "  Exchange".padEnd(20) + "Balance".padEnd(18) + "1d%".padEnd(10) + "7d%".padEnd(10) + "30d%";
  console.log(hdr);
  console.log("  " + "─".repeat(66));
  for (const ex of top10) {
    console.log(
      `  ${ex.exchange.padEnd(18)}${fmtAsset(ex.balance, asset).padEnd(18)}${fmtPct(ex.change1dPct).padEnd(10)}${fmtPct(ex.change7dPct).padEnd(10)}${fmtPct(ex.change30dPct)}`
    );
  }

  // 4. Analyze
  console.log("\n─── Analyzer output ──────────────────────────────");
  const prevState = loadDimState<ExchangeFlowsState>("exchange_flows_state.json", asset);
  if (prevState) {
    console.log(`  Previous regime         : ${prevState.regime} (since ${prevState.since})`);
  } else {
    console.log(`  Previous regime         : (none — first run)`);
  }

  const { context } = analyze(snapshot, prevState);
  const m = context.metrics;

  console.log(`\n  Regime                  : ${context.regime}`);
  console.log(`  Previous regime         : ${context.previousRegime ?? "(none)"}`);
  console.log(`  Since                   : ${context.since}`);
  console.log(`  Duration                : ${context.durationDays}d`);

  console.log("\n─── Computed metrics ─────────────────────────────");
  console.log(`  Total balance           : ${fmtAsset(m.totalBalance, asset)} (${fmtUsd(m.totalBalanceUsd)})`);
  console.log(`  1d net flow             : ${fmtAsset(m.netFlow1d, asset)}  (${fmtPct(m.reserveChange1dPct)})`);
  console.log(`  7d net flow             : ${fmtAsset(m.netFlow7d, asset)}  (${fmtPct(m.reserveChange7dPct)})`);
  console.log(`  30d net flow            : ${fmtAsset(m.netFlow30d, asset)}  (${fmtPct(m.reserveChange30dPct)})`);
  console.log(`  Daily flow mean (30d)   : ${fmtAsset(m.dailyFlowMean30d, asset)}`);
  console.log(`  Daily flow σ (30d)      : ${fmtAsset(m.dailyFlowSigma30d, asset)}`);
  console.log(`  Today's σ-score         : ${m.todaySigma.toFixed(2)}σ`);
  console.log(`  Flow percentile (1m)    : ${m.flowPercentile1m}th`);
  console.log(`  Balance trend           : ${m.balanceTrend}`);
  console.log(`  At 30d low?             : ${m.isAt30dLow}`);
  console.log(`  At 30d high?            : ${m.isAt30dHigh}`);

  // 5. Events
  if (context.events.length > 0) {
    console.log("\n─── Events ──────────────────────────────────────");
    for (const e of context.events) {
      console.log(`  [${e.type}] ${e.detail}`);
    }
  } else {
    console.log("\n─── Events: none ─────────────────────────────────");
  }

  // 6. Regime decision trace
  console.log("\n─── Regime decision trace ────────────────────────");
  console.log(`  flowPercentile1m >= 95 && todaySigma >= 2  → HEAVY_INFLOW?    ${m.flowPercentile1m >= 95 && m.todaySigma >= 2 ? "YES ✓" : `NO  (p=${m.flowPercentile1m}, σ=${m.todaySigma.toFixed(2)})`}`);
  console.log(`  flowPercentile1m <= 5  && todaySigma <= -2 → HEAVY_OUTFLOW?   ${m.flowPercentile1m <= 5 && m.todaySigma <= -2 ? "YES ✓" : `NO  (p=${m.flowPercentile1m}, σ=${m.todaySigma.toFixed(2)})`}`);
  console.log(`  netFlow7d < 0 && trend FALLING             → ACCUMULATION?    ${m.netFlow7d < 0 && m.balanceTrend === "FALLING" ? "YES ✓" : `NO  (7d=${fmtAsset(m.netFlow7d, asset)}, trend=${m.balanceTrend})`}`);
  console.log(`  netFlow7d > 0 && trend RISING              → DISTRIBUTION?    ${m.netFlow7d > 0 && m.balanceTrend === "RISING" ? "YES ✓" : `NO  (7d=${fmtAsset(m.netFlow7d, asset)}, trend=${m.balanceTrend})`}`);
  console.log(`  isAt30dLow && netFlow30d < 0               → ACCUMULATION?    ${m.isAt30dLow && m.netFlow30d < 0 ? "YES ✓" : `NO  (low=${m.isAt30dLow}, 30d=${fmtAsset(m.netFlow30d, asset)})`}`);
  console.log(`  isAt30dHigh && netFlow30d > 0              → DISTRIBUTION?    ${m.isAt30dHigh && m.netFlow30d > 0 ? "YES ✓" : `NO  (high=${m.isAt30dHigh}, 30d=${fmtAsset(m.netFlow30d, asset)})`}`);
  console.log(`  → Final regime: ${context.regime}`);

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
