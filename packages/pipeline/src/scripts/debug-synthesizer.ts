/**
 * Debug script — runs the full pipeline and synthesizer for a single asset.
 *
 * Shows:
 * 1. Dimension regime summary
 * 2. Mechanical trade decision with scores
 * 3. Full LLM input (system prompt + user prompt) — exactly what the model sees
 * 4. The synthesized brief output
 * 5. Data gap analysis — what's missing or weak in the input
 *
 * Usage:  tsx src/scripts/debug-synthesizer.ts [BTC|ETH]
 */

import "../env.js";
import chalk from "chalk";
import { runAllDimensions } from "../orchestrator/pipeline.js";
import { synthesize, buildPrompt, buildSystemPrompt } from "../orchestrator/synthesizer.js";
import { synthesizeRich } from "../orchestrator/rich-synthesizer.js";
import { computeDelta } from "../orchestrator/delta.js";
import {
  DIMENSION_LABELS,
  type DimensionOutput,
  type DerivativesOutput,
  type EtfsOutput,
  type HtfOutput,
  type SentimentOutput,
  type ExchangeFlowsOutput,
} from "../orchestrator/types.js";
import { computeConfluence, computeConvictionThreshold } from "../orchestrator/trade-idea/confluence.js";
import { EQUAL_WEIGHTS } from "../orchestrator/trade-idea/ic-weights.js";
import { computeBias } from "../orchestrator/trade-idea/bias.js";
import { computeCompositeTarget, type Direction } from "../orchestrator/trade-idea/composite-target.js";
import type { TradeDecision } from "../orchestrator/trade-idea/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function scoreStr(score: number): string {
  const s = score > 0 ? `+${score}` : `${score}`;
  if (score >= 50) return chalk.green.bold(s);
  if (score >= 20) return chalk.green(s);
  if (score <= -50) return chalk.red.bold(s);
  if (score <= -20) return chalk.red(s);
  return chalk.dim(s);
}

function wordWrap(text: string, indent: string, maxWidth: number): void {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.trim() === "") {
      console.log();
      continue;
    }
    const words = line.split(" ");
    let current = indent;
    for (const word of words) {
      const visible = current.replace(/\x1b\[[0-9;]*m/g, "").length;
      if (visible + word.replace(/\x1b\[[0-9;]*m/g, "").length > maxWidth) {
        console.log(current);
        current = indent + word + " ";
      } else {
        current += word + " ";
      }
    }
    if (current.trim()) console.log(current);
  }
}

function section(title: string): void {
  console.log("\n" + chalk.dim("═".repeat(70)));
  console.log(`  ${chalk.bold(title)}`);
  console.log(chalk.dim("═".repeat(70)) + "\n");
}

// ─── data gap analysis ───────────────────────────────────────────────────────

function analyzeGaps(outputs: DimensionOutput[], decision: TradeDecision | null): string[] {
  const gaps: string[] = [];

  // Missing dimensions
  const present = new Set(outputs.map((o) => o.dimension));
  const expected = ["DERIVATIVES", "ETFS", "HTF", "SENTIMENT", "EXCHANGE_FLOWS"] as const;
  for (const dim of expected) {
    if (!present.has(dim))
      gaps.push(`${chalk.red("MISSING")} ${DIMENSION_LABELS[dim]} — dimension pipeline failed or was skipped`);
  }

  // Derivatives gaps
  const deriv = outputs.find((o): o is DerivativesOutput => o.dimension === "DERIVATIVES");
  if (deriv) {
    const ctx = deriv.context;
    if (ctx.signals.priceReturn24h == null) gaps.push(`${chalk.yellow("STALE")} Derivatives: priceReturn24h is null`);
    if (ctx.signals.priceReturn7d == null) gaps.push(`${chalk.yellow("STALE")} Derivatives: priceReturn7d is null`);
    if (ctx.positioning.state === "POSITIONING_NEUTRAL" && ctx.stress.state === "STRESS_NONE") {
      gaps.push(`${chalk.dim("LOW SIGNAL")} Derivatives: neutral positioning + no stress — no contrarian edge`);
    }
  }

  // ETF gaps
  const etfs = outputs.find((o): o is EtfsOutput => o.dimension === "ETFS");
  if (etfs) {
    const flow = etfs.context.flow;
    if (Math.abs(flow.todaySigma) < 0.5) {
      gaps.push(
        `${chalk.dim("LOW SIGNAL")} ETFs: today's flow sigma ${flow.todaySigma.toFixed(2)} is unremarkable (< 0.5σ)`,
      );
    }
    if (etfs.context.regime === "ETF_NEUTRAL" || etfs.context.regime === "MIXED") {
      gaps.push(
        `${chalk.dim("LOW SIGNAL")} ETFs: regime is ${etfs.context.regime} — no institutional directional edge`,
      );
    }
  }

  // HTF gaps
  const htf = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  if (htf) {
    const ctx = htf.context;
    if (ctx.cvd.futures.divergence === "NONE" && ctx.cvd.spot.divergence === "NONE") {
      gaps.push(`${chalk.dim("LOW SIGNAL")} HTF: no CVD divergence on either futures or spot`);
    }
    if (ctx.staleness.rsiExtreme != null && ctx.staleness.rsiExtreme > 8) {
      gaps.push(`${chalk.yellow("STALE")} HTF: RSI extreme peaked ${ctx.staleness.rsiExtreme} candles ago (fading)`);
    }
    if (ctx.staleness.cvdDivergencePeak != null && ctx.staleness.cvdDivergencePeak > 5) {
      gaps.push(
        `${chalk.yellow("STALE")} HTF: CVD divergence R² peaked ${ctx.staleness.cvdDivergencePeak} candles ago (fading)`,
      );
    }
    if (ctx.regime === "RANGING") {
      gaps.push(`${chalk.dim("LOW SIGNAL")} HTF: RANGING regime — no directional structure`);
    }
    // Volatility
    if (
      !ctx.volatility.compressionAfterMove &&
      ctx.volatility.atrPercentile > 30 &&
      ctx.volatility.atrPercentile < 70
    ) {
      gaps.push(
        `${chalk.dim("LOW SIGNAL")} HTF: ATR at ${ctx.volatility.atrPercentile}th percentile — neither compressed nor expanded`,
      );
    }
  }

  // Sentiment gaps
  const sent = outputs.find((o): o is SentimentOutput => o.dimension === "SENTIMENT");
  if (sent) {
    const idx = sent.context.metrics.compositeIndex;
    if (idx >= 35 && idx <= 65) {
      gaps.push(
        `${chalk.dim("LOW SIGNAL")} Sentiment: composite F&G at ${idx.toFixed(0)} — neutral zone, no contrarian edge`,
      );
    }
    // Expert consensus disabled
    gaps.push(`${chalk.dim("DISABLED")} Sentiment: expert consensus at 0% weight (collecting baseline data)`);
  }

  // Exchange flows gaps
  const ef = outputs.find((o): o is ExchangeFlowsOutput => o.dimension === "EXCHANGE_FLOWS");
  if (ef) {
    if (ef.context.regime === "EF_NEUTRAL") {
      gaps.push(`${chalk.dim("LOW SIGNAL")} Exchange Flows: neutral regime — no clear accumulation/distribution`);
    }
  }

  // Trade decision gaps
  if (decision?.skipped) {
    const conf = decision.confluence;
    const weakest = (["derivatives", "etfs", "htf", "exchangeFlows"] as const)
      .map((d) => ({ dim: d, score: conf[d] }))
      .sort((a, b) => a.score - b.score);
    const worst = weakest[0]!;
    if (worst.score < 0) {
      gaps.push(
        `${chalk.yellow("OPPOSING")} Trade: ${worst.dim} scores ${worst.score} — actively opposing the direction`,
      );
    }
    const deficit = decision.threshold - conf.total;
    gaps.push(
      `${chalk.yellow("DEFICIT")} Trade: needs +${deficit} more conviction to pass threshold (${decision.threshold})`,
    );
  }

  return gaps;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  console.log(`\n🔍 Synthesizer Debug — ${asset}\n`);

  // 1. Run dimensions
  console.log("Running dimension pipelines...");
  const startTime = Date.now();
  const outputs = await runAllDimensions(asset);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ${outputs.length} dimensions completed in ${elapsed}s`);

  // ─── Delta ─────────────────────────────────────────────────────────
  section("DELTA ANALYSIS");
  const deltaSummary = await computeDelta(asset, outputs);
  const tierColor =
    deltaSummary.tier === "high" ? chalk.red : deltaSummary.tier === "medium" ? chalk.yellow : chalk.green;
  console.log(
    `  Tier: ${tierColor.bold(deltaSummary.tier.toUpperCase())}  Max Z: ${deltaSummary.maxZ === Infinity ? "∞" : deltaSummary.maxZ.toFixed(3)}`,
  );
  console.log(`  ${chalk.dim(deltaSummary.changeSummary)}`);

  // ─── Dimension regimes ──────────────────────────────────────────────
  section("DIMENSION REGIMES");
  for (const o of outputs) {
    console.log(`  ${DIMENSION_LABELS[o.dimension].padEnd(30)} ${chalk.bold(o.regime)}`);
  }

  // ─── Mechanical trade decision ──────────────────────────────────────
  section("MECHANICAL TRADE DECISION");

  const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  let decision: TradeDecision | null = null;

  if (htfOut) {
    const threshold = computeConvictionThreshold(htfOut.context);
    const directions: Direction[] = ["LONG", "SHORT", "FLAT"];
    const scored = directions.map((dir) => ({
      direction: dir,
      confluence: computeConfluence(outputs, dir, EQUAL_WEIGHTS),
    }));

    for (const s of scored) {
      const dims = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
      const parts = dims.map((d) => `${d}=${scoreStr(s.confluence[d])}`).join("  ");
      const totalColor =
        s.confluence.total >= threshold ? chalk.green.bold : s.confluence.total > 0 ? chalk.yellow : chalk.red;
      const passIcon = s.confluence.total >= threshold ? chalk.green(" ✓ TAKE") : "";
      console.log(
        `  ${chalk.bold(s.direction.padEnd(6))} ${parts}  total=${totalColor(String(s.confluence.total))}${passIcon}`,
      );
    }

    const directional = scored
      .filter((s) => s.direction !== "FLAT")
      .sort((a, b) => b.confluence.total - a.confluence.total);
    const bestDirectional = directional[0]!;
    const flatScore = scored.find((s) => s.direction === "FLAT")!;
    const chosen = bestDirectional.confluence.total >= threshold ? bestDirectional : flatScore;
    const skipped = chosen.direction !== "FLAT" ? false : bestDirectional.confluence.total < threshold;
    const trackDirection = skipped ? bestDirectional : chosen;
    const { entryPrice, compositeTarget } = computeCompositeTarget(htfOut.context, trackDirection.direction);

    const longConf = scored.find((s) => s.direction === "LONG")!.confluence;
    const shortConf = scored.find((s) => s.direction === "SHORT")!.confluence;
    const bias = computeBias(longConf, shortConf);

    decision = {
      direction: trackDirection.direction,
      confluence: trackDirection.confluence,
      entryPrice,
      compositeTarget,
      skipped,
      threshold,
      alternatives: scored
        .filter((s) => s.direction !== trackDirection.direction)
        .map((s) => ({ direction: s.direction, total: s.confluence.total })),
      bias,
      weights: {
        derivatives: 1,
        etfs: 1,
        htf: 1,
        exchangeFlows: 1,
        calibrated: false,
        sampleCount: 0,
        ic: { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 },
      },
    };

    console.log();
    const decisionIcon = skipped ? chalk.yellow("SKIPPED") : chalk.green("TAKEN");
    console.log(`  Decision: ${chalk.bold(trackDirection.direction)} — ${decisionIcon}`);
    console.log(`  Entry: $${entryPrice.toFixed(2)}  Target: $${compositeTarget.toFixed(2)}`);
    console.log(
      `  Conviction: ${trackDirection.confluence.total} / ${threshold}${threshold < 200 ? chalk.dim(` (compression-adjusted, default 200)`) : ""}`,
    );
  } else {
    console.log(chalk.dim("  No HTF output — cannot compute trade decision"));
  }

  // ─── Data gap analysis ──────────────────────────────────────────────
  section("DATA GAP ANALYSIS");

  const gaps = analyzeGaps(outputs, decision);
  if (gaps.length === 0) {
    console.log(chalk.green("  No gaps detected — all signals are active and fresh."));
  } else {
    for (const gap of gaps) {
      console.log(`  • ${gap}`);
    }
  }

  // ─── Rich brief (input to text synth) ────────────────────────────
  section("RICH BRIEF (infographic → text synth input)");

  const richStart = Date.now();
  const richBrief = await synthesizeRich(asset, outputs);
  const richElapsed = ((Date.now() - richStart) / 1000).toFixed(1);

  if (richBrief) {
    console.log(chalk.dim(`  ${richBrief.blocks.length} blocks generated in ${richElapsed}s\n`));
    for (const block of richBrief.blocks) {
      const tag = chalk.cyan(`[${block.type}]`);
      if (block.type === "regime_banner") {
        console.log(
          `  ${tag} ${chalk.bold(block.regime)} — ${block.sentiment}${block.subtitle ? ` (${block.subtitle})` : ""}`,
        );
      } else if (block.type === "tension") {
        console.log(`  ${tag} ${block.title}: ${block.left.label} vs ${block.right.label}`);
      } else if (block.type === "callout") {
        console.log(`  ${tag} ${chalk.bold(`[${block.variant}]`)} ${block.title}`);
        console.log(`         ${chalk.dim(block.content.slice(0, 100))}${block.content.length > 100 ? "..." : ""}`);
      } else if (block.type === "signal") {
        console.log(`  ${tag} ${block.direction} (${block.strength}/3) — ${block.label}`);
      } else if (block.type === "level_map") {
        console.log(
          `  ${tag} current=$${block.current.toLocaleString()} levels: ${block.levels.map((l) => `${l.label}@$${l.price.toLocaleString()}`).join(", ")}`,
        );
      } else if (block.type === "metric_row") {
        const items = block.items
          .map((i) => `${i.label}=${i.value}${i.sentiment ? ` (${i.sentiment})` : ""}`)
          .join("  ");
        console.log(`  ${tag} ${items}`);
      } else if (block.type === "heading") {
        console.log(`  ${tag} ${chalk.bold(block.text)}`);
      } else if (block.type === "scorecard") {
        const items = block.items.map((i) => `${i.label}=${i.score}`).join("  ");
        console.log(`  ${tag} ${block.title ?? ""} ${items}`);
      } else if (block.type === "spectrum") {
        console.log(`  ${tag} ${block.label}: ${block.value} (${block.leftLabel} ↔ ${block.rightLabel})`);
      } else if (block.type === "heatmap") {
        const cells = block.cells.map((c) => `${c.label}=${c.value}`).join("  ");
        console.log(`  ${tag} ${block.title ?? ""} ${cells}`);
      } else if (block.type === "text") {
        console.log(`  ${tag} ${chalk.dim(block.content.slice(0, 80))}${block.content.length > 80 ? "..." : ""}`);
      } else {
        console.log(`  ${tag}`);
      }
    }
  } else {
    console.log(chalk.yellow("  Rich brief failed — text synth will use dimension interpretations as fallback"));
  }

  // ─── LLM input: system prompt ──────────────────────────────────────
  section("LLM INPUT: SYSTEM PROMPT");

  const isDelta = deltaSummary.tier === "medium";
  const systemPrompt = buildSystemPrompt(decision, isDelta);
  console.log(chalk.dim("  (This is the system message the text synthesizer receives)\n"));
  wordWrap(systemPrompt, "  ", 70);
  console.log(`\n  ${chalk.dim(`${systemPrompt.length} chars`)}`);

  // ─── LLM input: user prompt ────────────────────────────────────────
  section("LLM INPUT: USER PROMPT");

  const userPrompt = buildPrompt(asset, outputs, decision);
  console.log(chalk.dim("  (Rich brief minified JSON + trade decision)\n"));

  // The prompt is now minified — show it line by line with coloring
  for (const line of userPrompt.split("\n")) {
    if (line.startsWith("###")) {
      console.log(`  ${chalk.cyan.bold(line)}`);
    } else if (line.startsWith("**")) {
      console.log(`  ${chalk.white(line)}`);
    } else if (line.startsWith("---")) {
      console.log(`  ${chalk.dim(line)}`);
    } else if (line.startsWith("[{") || line.startsWith("{")) {
      // Minified JSON — show truncated
      const preview = line.length > 200 ? line.slice(0, 200) + chalk.dim(` ... (${line.length} chars total)`) : line;
      console.log(`  ${chalk.dim(preview)}`);
    } else {
      console.log(`  ${line}`);
    }
  }

  console.log(`\n  ${chalk.dim(`${userPrompt.length} chars, ~${Math.round(userPrompt.length / 4)} tokens est.`)}`);

  // ─── Synthesized brief ─────────────────────────────────────────────
  section("SYNTHESIZED BRIEF OUTPUT");

  const synthStart = Date.now();
  const brief = await synthesize(asset, outputs, decision, deltaSummary);
  const synthElapsed = ((Date.now() - synthStart) / 1000).toFixed(1);

  const rendered = brief
    .replace(/\*\*(.+?)\*\*/g, (_, t: string) => chalk.bold(t))
    .replace(/\*(.+?)\*/g, "$1")
    .trim();

  wordWrap(rendered, "  ", 70);

  console.log(`\n  ${chalk.dim(`(${synthElapsed}s, ${brief.length} chars, ${brief.split(/\s+/).length} words)`)}`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
