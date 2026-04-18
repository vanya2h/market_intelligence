/**
 * Debug script — full sentiment / composite Fear & Greed breakdown.
 *
 * Usage:  tsx src/scripts/debug-sentiment.ts --asset [BTC|ETH]
 */

import fs from "node:fs";
import path from "node:path";
import { analyze as analyzeSentiment } from "../sentiment/analyzer.js";
import { collect as collectSentiment } from "../sentiment/collector.js";
import type { SentimentState } from "../sentiment/types.js";
import { parseAsset } from "./utils.js";
import "../env.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function label(score: number): string {
  if (score < 20) return "EXTREME FEAR";
  if (score < 40) return "FEAR";
  if (score <= 60) return "NEUTRAL";
  if (score <= 80) return "GREED";
  return "EXTREME GREED";
}

function bar(score: number, width = 30): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const indicator = score < 40 ? "🔴" : score <= 60 ? "🟡" : "🟢";
  return `${indicator} ${"█".repeat(filled)}${"░".repeat(empty)} ${score.toFixed(1)}`;
}

function loadDimState<T>(file: string, asset: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  return (all[asset] ?? all) as T;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  console.log(`\n🔍 Sentiment debug — ${asset}\n`);

  // 1. Collect & analyze
  console.log("Fetching all dimensions...");
  const snapshot = await collectSentiment(asset);
  const prevState = loadDimState<SentimentState>("sentiment_state.json", asset);
  const { context } = analyzeSentiment(snapshot, prevState);
  const m = context.metrics;
  const cd = snapshot.crossDimensions;

  // 2. Component scores with sub-breakdowns
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  COMPOSITE FEAR & GREED INDEX");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  ${bar(m.compositeIndex, 40)}  → ${m.compositeLabel}`);
  console.log(`  Regime: ${context.regime} (since ${context.since.slice(0, 10)}, ${context.durationDays}d)`);
  if (context.previousRegime) {
    console.log(`  Previous: ${context.previousRegime}`);
  }

  // ─── Positioning (40%) ───
  console.log("\n─── Positioning (40%) ────────────────────────────");
  console.log(`  Score: ${bar(m.components.positioning)}`);
  if (cd.derivatives) {
    const d = cd.derivatives;
    console.log(`  Inputs:`);
    console.log(`    Funding percentile    : ${d.fundingPercentile1m.toFixed(1)}`);
    console.log(`    CB premium percentile : ${d.cbPremiumPercentile1m.toFixed(1)}`);
    console.log(`    OI percentile         : ${d.oiPercentile1m.toFixed(1)}`);
    console.log(`    Liq percentile        : ${d.liqPercentile1m.toFixed(1)}  (long bias: ${d.liqLongPct}%)`);
    console.log(`    Regime                : ${d.regime}`);

    // Sub-score breakdown
    const longBias = d.liqLongPct / 100;
    const liqBearish = 100 - d.liqPercentile1m;
    const liqBullish = d.liqPercentile1m;
    const liqScore = liqBullish * (1 - longBias) + liqBearish * longBias;
    const raw =
      d.fundingPercentile1m * 0.35 + d.cbPremiumPercentile1m * 0.25 + d.oiPercentile1m * 0.25 + liqScore * 0.15;
    console.log(`  Sub-scores:`);
    console.log(`    Funding  (35%)        : ${(d.fundingPercentile1m * 0.35).toFixed(1)}`);
    console.log(`    CB prem  (25%)        : ${(d.cbPremiumPercentile1m * 0.25).toFixed(1)}`);
    console.log(`    OI       (25%)        : ${(d.oiPercentile1m * 0.25).toFixed(1)}`);
    console.log(`    Liqs     (15%)        : ${(liqScore * 0.15).toFixed(1)}  (adj liq score: ${liqScore.toFixed(1)})`);
    console.log(`    Raw total             : ${raw.toFixed(1)}`);
  } else {
    console.log(`  ⚠ Derivatives data unavailable — using neutral (50)`);
  }

  // ─── Institutional Flows (30%) ───
  console.log("\n─── Institutional Flows (30%) ────────────────────");
  console.log(`  Score: ${bar(m.components.institutionalFlows)}`);
  if (cd.etfs) {
    const e = cd.etfs;
    console.log(`  Inputs:`);
    console.log(`    Inflow streak         : ${e.consecutiveInflowDays}d`);
    console.log(`    Outflow streak        : ${e.consecutiveOutflowDays}d`);
    console.log(`    Today's σ             : ${e.todaySigma.toFixed(2)}`);
    console.log(`    Regime                : ${e.regime}`);

    let streakScore = 50;
    if (e.consecutiveInflowDays > 0) streakScore = clamp(50 + e.consecutiveInflowDays * 7);
    else if (e.consecutiveOutflowDays > 0) streakScore = clamp(50 - e.consecutiveOutflowDays * 7);
    const sigmaScore = clamp(50 + e.todaySigma * 15);
    let regimeBonus = 0;
    if (e.regime === "STRONG_INFLOW") regimeBonus = 10;
    else if (e.regime === "STRONG_OUTFLOW") regimeBonus = -10;
    else if (e.regime === "REVERSAL_TO_INFLOW") regimeBonus = 5;
    else if (e.regime === "REVERSAL_TO_OUTFLOW") regimeBonus = -5;
    console.log(`  Sub-scores:`);
    console.log(`    Streak  (50%)         : ${streakScore.toFixed(1)}`);
    console.log(`    Sigma   (50%)         : ${sigmaScore.toFixed(1)}`);
    console.log(`    Regime bonus          : ${regimeBonus > 0 ? "+" : ""}${regimeBonus}`);
  } else {
    console.log(`  ⚠ ETF data unavailable — using neutral (50)`);
  }

  // ─── Trend (15%) ───
  console.log("\n─── Trend (15%) ──────────────────────────────────");
  console.log(`  Score: ${bar(m.components.trend)}`);
  if (cd.htf) {
    const h = cd.htf;
    console.log(`  Inputs:`);
    console.log(`    Price vs SMA-200      : ${h.priceVsSma200Pct.toFixed(2)}%`);
    console.log(`    Price vs SMA-50       : ${h.priceVsSma50Pct.toFixed(2)}%`);
    console.log(`    Daily RSI             : ${h.dailyRsi.toFixed(1)}`);
    console.log(`    Structure             : ${h.structure}`);

    const sma200Score = clamp(50 + h.priceVsSma200Pct * 4);
    const sma50Score = clamp(50 + h.priceVsSma50Pct * 5);
    let structureScore = 50;
    if (h.structure === "HH_HL") structureScore = 75;
    else if (h.structure === "LH_LL") structureScore = 25;
    else if (h.structure === "HH_LL") structureScore = 55;
    else if (h.structure === "LH_HL") structureScore = 45;
    console.log(`  Sub-scores:`);
    console.log(`    SMA-200 (30%)         : ${sma200Score.toFixed(1)}`);
    console.log(`    SMA-50  (20%)         : ${sma50Score.toFixed(1)}`);
    console.log(`    RSI     (30%)         : ${h.dailyRsi.toFixed(1)}`);
    console.log(`    Structure (20%)       : ${structureScore}`);
  } else {
    console.log(`  ⚠ HTF data unavailable — using neutral (50)`);
  }

  // ─── ATR Volatility (informational — not in composite) ───
  console.log("\n─── ATR Volatility (not in composite) ────────────");
  if (cd.htf) {
    const h = cd.htf;
    console.log(`    ATR-14 (4h)           : ${h.atr}`);
    console.log(`    ATR ratio             : ${h.atrRatio}`);
    const compression = clamp((1 - h.atrRatio) * 100 + 50);
    console.log(`    Compression           : ${compression.toFixed(1)}`);
  } else {
    console.log(`  ⚠ HTF data unavailable`);
  }

  // ─── Expert Consensus (0% — disabled) ───
  console.log("\n─── Expert Consensus (0% — disabled) ─────────────");
  console.log(`  Score: ${bar(m.components.expertConsensus)}`);
  if (snapshot.consensus.length > 0) {
    const latest = snapshot.consensus[0]!;
    console.log(`  Inputs:`);
    console.log(`    Consensus index       : ${m.consensusIndex.toFixed(1)}`);
    console.log(`    30d MA                : ${m.consensusIndex30dMa.toFixed(1)}`);
    console.log(`    Z-score               : ${m.zScore.toFixed(2)}`);
    console.log(`    7d delta              : ${m.consensusDelta7d > 0 ? "+" : ""}${m.consensusDelta7d.toFixed(1)}`);
    console.log(`    Analysts              : ${m.totalAnalysts} (${Math.round(m.bullishRatio * 100)}% bullish)`);
    console.log(
      `    Opinions              : ${latest.totalOpinions} (${latest.bullishOpinions}B / ${latest.bearishOpinions}Be)`,
    );
  } else {
    console.log(`  ⚠ No consensus data`);
  }

  // ─── Weighted contribution table ───
  console.log("\n─── Weighted contributions ───────────────────────");
  const weights = {
    positioning: 0.5,
    institutionalFlows: 0.3,
    exchangeFlows: 0,
    trend: 0.2,
    expertConsensus: 0,
  };
  const components = [
    ["Positioning", m.components.positioning, weights.positioning],
    ["Inst. Flows", m.components.institutionalFlows, weights.institutionalFlows],
    ["Exch. Flows", m.components.exchangeFlows, weights.exchangeFlows],
    ["Trend", m.components.trend, weights.trend],
    ["Expert Consensus", m.components.expertConsensus, weights.expertConsensus],
  ] as const;

  const hdr = "  Component".padEnd(24) + "Score".padEnd(10) + "Weight".padEnd(10) + "Contribution";
  console.log(hdr);
  console.log("  " + "─".repeat(54));
  let total = 0;
  for (const [name, score, weight] of components) {
    const contrib = score * weight;
    total += contrib;
    const wPct = `${(weight * 100).toFixed(0)}%`;
    console.log(
      `  ${name}`.padEnd(24) + `${score.toFixed(1)}`.padEnd(10) + `${wPct}`.padEnd(10) + `${contrib.toFixed(2)}`,
    );
  }
  console.log("  " + "─".repeat(54));
  console.log(
    `  ${"TOTAL".padEnd(22)}${clamp(Math.round(total * 10) / 10)
      .toFixed(1)
      .padEnd(10)}${"100%".padEnd(10)}${total.toFixed(2)}`,
  );

  // ─── Divergence ───
  if (m.divergence) {
    console.log(`\n  ⚡ DIVERGENCE DETECTED: ${m.divergenceType}`);
  }

  // ─── Events ───
  if (context.events.length > 0) {
    console.log("\n─── Events ───────────────────────────────────────");
    for (const ev of context.events) {
      console.log(`  [${ev.type}] ${ev.detail}`);
    }
  }

  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
