/**
 * Orchestrator runner — Market Brief
 *
 * Runs all implemented dimension pipelines, then synthesizes
 * a unified market brief via the orchestrator LLM.
 *
 * Usage:
 *   pnpm brief
 *   pnpm brief --asset ETH
 */

import chalk from "chalk";
import type { AssetType } from "../types.js";
import { processTradeIdea, type TradeDecision } from "./trade-idea/index.js";
import { computeDelta } from "./delta.js";
import { saveBrief, updateBrief } from "./persist.js";
import { runAllDimensions } from "./pipeline.js";
import { synthesizeRich } from "./rich-synthesizer.js";
import { synthesize } from "./synthesizer.js";
import { DIMENSION_LABELS, type DimensionOutput, type HtfOutput } from "./types.js";
import "../env.js";

// ─── Formatters ───────────────────────────────────────────────────────────────

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

function regimeTag(regime: string): string {
  const lower = regime.toLowerCase();
  if (lower.includes("bullish") || lower.includes("inflow") || lower.includes("greed")) {
    return chalk.green.bold(regime);
  }
  if (
    lower.includes("bearish") ||
    lower.includes("outflow") ||
    lower.includes("fear") ||
    lower.includes("capitulation")
  ) {
    return chalk.red.bold(regime);
  }
  if (lower.includes("divergence") || lower.includes("heating") || lower.includes("squeeze")) {
    return chalk.yellow.bold(regime);
  }
  return chalk.white.bold(regime);
}

/** Strip markdown and render **bold** with chalk */
function renderMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/\*(.+?)\*/g, "$1")
    .trim();
}

function wordWrap(text: string, indent: string, maxWidth: number): void {
  const lines = text.split("\n");
  for (const rawLine of lines) {
    if (rawLine.trim() === "") {
      console.log("");
      continue;
    }
    const words = rawLine.split(" ");
    let line = indent;
    for (const word of words) {
      const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
      if (visibleLen + word.replace(/\x1b\[[0-9;]*m/g, "").length > maxWidth) {
        console.log(line);
        line = indent + word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.trim()) console.log(line);
  }
}

// ─── Brief printer ────────────────────────────────────────────────────────────

function printDimensionSummary(outputs: DimensionOutput[]): void {
  const pad = (s: string) => s.padEnd(30);
  for (const o of outputs) {
    console.log(`      ${chalk.dim(pad(DIMENSION_LABELS[o.dimension]))} ${regimeTag(o.regime)}`);
  }
}

function printBrief(asset: string, outputs: DimensionOutput[], brief: string): void {
  const sep = chalk.dim("═".repeat(62));
  const thinSep = chalk.dim("─".repeat(62));

  console.log(`\n${sep}`);
  console.log(`  ${chalk.bold.white("MARKET BRIEF")}  ${chalk.dim(asset)}  ${chalk.dim(new Date().toUTCString())}`);
  console.log(sep);

  // Dimension regime summary
  console.log(`\n  ${chalk.dim("── Dimension Regimes ────────────────────────────")}`);
  for (const o of outputs) {
    const pad = (s: string) => s.padEnd(28);
    console.log(`  ${chalk.dim(pad(DIMENSION_LABELS[o.dimension]))} ${regimeTag(o.regime)}`);
  }

  // Synthesized brief
  console.log(`\n${thinSep}`);
  const rendered = renderMarkdown(brief);
  wordWrap(rendered, "  ", 62);

  console.log(`\n${sep}\n`);
}

// ─── Main (reusable) ──────────────────────────────────────────────────────────

export async function runBrief(assets: AssetType[]): Promise<void> {
  for (const asset of assets) {
    const totalSteps = 4;

    step(1, totalSteps, `Running all dimension pipelines (${asset})...`);
    const startTime = Date.now();
    const outputs = await runAllDimensions(asset);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    note(`${outputs.length} dimensions completed in ${elapsed}s`);
    console.log("");
    printDimensionSummary(outputs);

    // Delta must be computed BEFORE saving the placeholder brief,
    // otherwise loadPreviousBriefContexts picks up the placeholder
    // (same context data) and all deltas come out as zero.
    step(2, totalSteps, "Computing delta...");
    const deltaSummary = await computeDelta(asset, outputs);
    note(
      `delta: tier=${deltaSummary.tier}, maxZ=${deltaSummary.maxZ === Infinity ? "∞" : deltaSummary.maxZ.toFixed(2)}`,
    );

    step(3, totalSteps, "Computing trade idea & synthesizing market brief...");
    const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
    let decision: TradeDecision | null = null;
    let briefId: string | undefined;

    if (htfOut) {
      // Save a placeholder brief (we need briefId for the trade idea)
      briefId = await saveBrief(asset, "", outputs, null);
      const result = await processTradeIdea(briefId, asset, htfOut.context, outputs);
      decision = result.decision;
    } else {
      note("no HTF output — trade idea skipped");
    }
    const richBrief = await synthesizeRich(asset, outputs);
    if (richBrief) note("rich brief generated");
    const brief = await synthesize(asset, outputs, decision, deltaSummary);
    note(`text brief generated (${deltaSummary.tier} significance)`);

    step(4, totalSteps, "Saving to database...");
    if (briefId) {
      // Update the placeholder brief with the synthesized text
      await updateBrief(briefId, brief, richBrief);
    } else {
      await saveBrief(asset, brief, outputs, richBrief);
    }

    printBrief(asset, outputs, brief);
  }
}
