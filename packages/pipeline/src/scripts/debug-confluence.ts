/**
 * Debug script — sanity-checks the new confluence scoring system.
 *
 * Runs all dimension pipelines against live data, then shows the full
 * scoring breakdown for each direction (LONG / SHORT / FLAT).
 *
 * Usage:  tsx src/scripts/debug-confluence.ts [BTC|ETH]
 */

import "../env.js";
import chalk from "chalk";
import { runAllDimensions } from "../orchestrator/pipeline.js";
import { computeConfluence, CONVICTION_THRESHOLD } from "../orchestrator/trade-idea/confluence.js";
import type { DimensionOutput, DerivativesOutput, EtfsOutput, HtfOutput, SentimentOutput, ExchangeFlowsOutput } from "../orchestrator/types.js";
import type { Direction } from "../orchestrator/trade-idea/composite-target.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function bar(value: number, max: number, width: number): string {
  const filled = Math.round((Math.abs(value) / max) * width);
  const ch = value >= 0 ? chalk.green("█") : chalk.red("█");
  const empty = chalk.dim("░");
  const half = Math.floor(width / 2);

  if (value >= 0) {
    return empty.repeat(half) + ch.repeat(Math.min(filled, half)) + empty.repeat(Math.max(0, half - filled));
  }
  const start = Math.max(0, half - filled);
  return empty.repeat(start) + ch.repeat(Math.min(filled, half)) + empty.repeat(half);
}

function scoreStr(score: number): string {
  const s = score > 0 ? `+${score}` : `${score}`;
  if (score >= 50) return chalk.green.bold(s);
  if (score >= 20) return chalk.green(s);
  if (score <= -50) return chalk.red.bold(s);
  if (score <= -20) return chalk.red(s);
  return chalk.dim(s);
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

// ─── dimension detail printers ───────────────────────────────────────────────

function printDerivativesDetail(out: DerivativesOutput) {
  const ctx = out.context;
  console.log(chalk.dim("    ┌─ Derivatives Context ─────────────────────────"));
  console.log(`    │ Positioning   : ${chalk.bold(ctx.positioning.state)}`);
  console.log(`    │ Stress        : ${chalk.bold(ctx.stress.state)}`);
  console.log(`    │ Funding pctl  : ${pct(ctx.signals.fundingPct1m)}`);
  console.log(`    │ Funding side  : ${ctx.signals.fundingPressureSide ?? "—"}  cycles: ${ctx.signals.fundingPressureCycles}`);
  console.log(`    │ OI signal     : ${chalk.bold(ctx.oiSignal)}`);
  console.log(`    │ OI Δ24h       : ${pct(ctx.signals.oiChange24h * 100)}  Δ7d: ${pct(ctx.signals.oiChange7d * 100)}  z: ${ctx.signals.oiZScore30d.toFixed(2)}`);
  console.log(`    │ Liq pctl 1m   : ${pct(ctx.signals.liqPct1m)}  3m: ${pct(ctx.signals.liqPct3m)}`);
  console.log(chalk.dim("    └──────────────────────────────────────────────"));
}

function printEtfsDetail(out: EtfsOutput) {
  const ctx = out.context;
  const f = ctx.flow;
  console.log(chalk.dim("    ┌─ ETF Context ────────────────────────────────"));
  console.log(`    │ Regime        : ${chalk.bold(ctx.regime)}  (prev: ${ctx.previousRegime ?? "—"})`);
  console.log(`    │ Today σ       : ${chalk.bold(f.todaySigma.toFixed(2))}  ($${(f.today / 1e6).toFixed(1)}M)`);
  console.log(`    │ Inflow streak : ${f.consecutiveInflowDays}d   Outflow streak: ${f.consecutiveOutflowDays}d`);
  console.log(`    │ 3d flow       : $${(f.d3Sum / 1e6).toFixed(1)}M   7d: $${(f.d7Sum / 1e6).toFixed(1)}M   30d: $${(f.d30Sum / 1e6).toFixed(1)}M`);
  console.log(`    │ Percentile 1m : ${pct(f.percentile1m)}`);
  console.log(`    │ Reversal ratio: ${(f.reversalRatio * 100).toFixed(1)}%`);
  console.log(chalk.dim("    └──────────────────────────────────────────────"));
}

function printHtfDetail(out: HtfOutput) {
  const ctx = out.context;
  console.log(chalk.dim("    ┌─ HTF Context ────────────────────────────────"));
  console.log(`    │ Regime        : ${chalk.bold(ctx.regime)}  (prev: ${ctx.previousRegime ?? "—"})`);
  console.log(`    │ Structure     : ${chalk.bold(ctx.structure)}`);
  console.log(`    │ RSI 4h        : ${chalk.bold(ctx.rsi.h4.toFixed(1))}   daily: ${ctx.rsi.daily.toFixed(1)}`);
  console.log(`    │ Price vs SMA  : 50=${pct(ctx.ma.priceVsSma50Pct)}  200=${pct(ctx.ma.priceVsSma200Pct)}`);
  console.log(`    │ CVD futures   : div=${chalk.bold(ctx.cvd.futures.divergence)}  R²=${ctx.cvd.futures.short.r2.toFixed(2)}/${ctx.cvd.futures.long.r2.toFixed(2)}`);
  console.log(`    │ CVD spot      : div=${chalk.bold(ctx.cvd.spot.divergence)}`);
  console.log(`    │ ATR           : ${ctx.atr.toFixed(1)}`);
  // Volatility compression
  const vol = ctx.volatility;
  const springIcon = vol.compressionAfterMove ? chalk.yellow.bold("⚡ COILED") : chalk.dim("—");
  console.log(`    │ Vol pctl      : ${pct(vol.atrPercentile)}   ratio: ${vol.atrRatio.toFixed(3)}   displacement: ${vol.recentDisplacement.toFixed(1)} ATR   ${springIcon}`);
  console.log(chalk.dim("    └──────────────────────────────────────────────"));
}

function printExchangeFlowsDetail(out: ExchangeFlowsOutput) {
  const ctx = out.context;
  const m = ctx.metrics;
  console.log(chalk.dim("    ┌─ Exchange Flows Context ─────────────────────"));
  console.log(`    │ Regime        : ${chalk.bold(ctx.regime)}  (prev: ${ctx.previousRegime ?? "—"})`);
  console.log(`    │ Duration      : ${ctx.durationDays}d`);
  console.log(`    │ Net flow 1d   : ${(m.netFlow1d >= 0 ? "+" : "") + m.netFlow1d.toFixed(2)}  7d: ${(m.netFlow7d >= 0 ? "+" : "") + m.netFlow7d.toFixed(2)}`);
  console.log(`    │ Reserve 1d%   : ${pct(m.reserveChange1dPct)}  7d: ${pct(m.reserveChange7dPct)}  30d: ${pct(m.reserveChange30dPct)}`);
  console.log(`    │ Today σ       : ${chalk.bold(m.todaySigma.toFixed(2))}   pctl 1m: ${m.flowPercentile1m}th`);
  console.log(`    │ Balance trend : ${chalk.bold(m.balanceTrend)}   at 30d low: ${m.isAt30dLow}   at 30d high: ${m.isAt30dHigh}`);
  if (ctx.events.length > 0) {
    for (const e of ctx.events) {
      console.log(`    │ Event         : [${e.type}] ${e.detail}`);
    }
  }
  console.log(chalk.dim("    └──────────────────────────────────────────────"));
}

function printSentimentDetail(out: SentimentOutput) {
  const ctx = out.context;
  const m = ctx.metrics;
  const c = m.components;
  console.log(chalk.dim("    ┌─ Sentiment Context ──────────────────────────"));
  console.log(`    │ Regime        : ${chalk.bold(ctx.regime)}`);
  console.log(`    │ Composite F&G : ${chalk.bold(String(m.compositeIndex.toFixed(0)))} (${m.compositeLabel})`);
  console.log(`    │ Components    : pos=${c.positioning.toFixed(0)} trend=${c.trend.toFixed(0)} mom=${c.momentumDivergence.toFixed(0)} etf=${c.institutionalFlows.toFixed(0)} exch=${c.exchangeFlows.toFixed(0)}`);
  const fearCount = [c.positioning, c.trend, c.momentumDivergence, c.institutionalFlows, c.exchangeFlows].filter((v) => v < 40).length;
  const greedCount = [c.positioning, c.trend, c.momentumDivergence, c.institutionalFlows, c.exchangeFlows].filter((v) => v > 60).length;
  console.log(`    │ Convergence   : ${fearCount} fear / ${greedCount} greed (of 5)`);
  console.log(chalk.dim("    └──────────────────────────────────────────────"));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  console.log(`\n🔍 Confluence Scoring Debug — ${asset}\n`);

  console.log("Running dimension pipelines...");
  const startTime = Date.now();
  const outputs = await runAllDimensions(asset);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ${outputs.length} dimensions completed in ${elapsed}s\n`);

  // Extract typed outputs
  const deriv = outputs.find((o): o is DerivativesOutput => o.dimension === "DERIVATIVES");
  const etfs = outputs.find((o): o is EtfsOutput => o.dimension === "ETFS");
  const htf = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  const sent = outputs.find((o): o is SentimentOutput => o.dimension === "SENTIMENT");
  const ef = outputs.find((o): o is ExchangeFlowsOutput => o.dimension === "EXCHANGE_FLOWS");

  // Print dimension contexts
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  DIMENSION CONTEXTS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (deriv) printDerivativesDetail(deriv);
  if (etfs) printEtfsDetail(etfs);
  if (htf) printHtfDetail(htf);
  if (ef) printExchangeFlowsDetail(ef);
  if (sent) printSentimentDetail(sent);

  // Score for each direction
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SCORING BY DIRECTION");
  console.log("═══════════════════════════════════════════════════════════════");

  const directions: Direction[] = ["LONG", "SHORT", "FLAT"];

  for (const dir of directions) {
    const confluence = computeConfluence(outputs, dir);
    const passes = dir === "FLAT" || confluence.total >= CONVICTION_THRESHOLD;
    const passIcon = dir === "FLAT"
      ? chalk.yellow("TRACK")
      : passes ? chalk.green.bold("TAKE ✓") : chalk.red("SKIP ✗");

    console.log(`\n  ── ${chalk.bold(dir)} ──────────────────────── ${passIcon}`);
    console.log();

    // Per-dimension breakdown with visual bars
    const dims = [
      { name: "Derivatives", score: confluence.derivatives },
      { name: "ETFs       ", score: confluence.etfs },
      { name: "HTF        ", score: confluence.htf },
      { name: "Exch Flows ", score: confluence.exchangeFlows },
      { name: "Sentiment  ", score: confluence.sentiment },
    ];

    for (const dim of dims) {
      console.log(
        `    ${dim.name}  ${bar(dim.score, 100, 40)}  ${scoreStr(dim.score).padStart(12)}`,
      );
    }

    console.log();
    const totalStr = confluence.total >= CONVICTION_THRESHOLD
      ? chalk.green.bold(String(confluence.total))
      : confluence.total > 0
        ? chalk.yellow(String(confluence.total))
        : chalk.red(String(confluence.total));
    console.log(`    ${"Total      ".padEnd(11)}  ${" ".repeat(40)}  ${totalStr.padStart(12)} / ${CONVICTION_THRESHOLD}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
