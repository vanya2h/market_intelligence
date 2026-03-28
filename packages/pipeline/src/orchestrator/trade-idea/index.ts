/**
 * Trade Idea — Barrel Orchestrator
 *
 * Fully mechanical trade idea generation:
 * 1. Score confluence for all three directions (LONG / SHORT / FLAT)
 * 2. Pick the direction with highest conviction
 * 3. Compute composite target + R:R levels from HTF context
 * 4. Always persist (skipped ideas tracked for model accuracy measurement)
 *
 * The LLM synthesizer receives our mechanical decision and describes it
 * in human-readable form — it does NOT pick the direction.
 */

import chalk from "chalk";
import type { $Enums } from "../../generated/prisma/client.js";
import type { HtfContext } from "../../htf/types.js";
import type { DimensionOutput } from "../types.js";
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { computeConfluence, CONVICTION_THRESHOLD, type Confluence } from "./confluence.js";
import { saveTradeIdea } from "./persist.js";

/** Result of the mechanical trade decision — passed to the synthesizer */
export interface TradeDecision {
  direction: Direction;
  confluence: Confluence;
  entryPrice: number;
  compositeTarget: number;
  skipped: boolean;
  /** Why this direction was chosen over the alternatives */
  alternatives: { direction: Direction; total: number }[];
}

/**
 * Mechanically pick the best direction and compute the trade idea.
 * Returns the trade decision (for the synthesizer) and the persisted idea ID.
 */
export async function processTradeIdea(
  briefId: string,
  asset: $Enums.Asset,
  htfContext: HtfContext,
  outputs: DimensionOutput[],
): Promise<{ id: string; decision: TradeDecision }> {
  // Score all three directions mechanically
  const directions: Direction[] = ["LONG", "SHORT", "FLAT"];
  const scored = directions.map((dir) => ({
    direction: dir,
    confluence: computeConfluence(outputs, dir),
  }));

  // Pick the directional candidate with the highest total (exclude FLAT from competition)
  const directional = scored
    .filter((s) => s.direction !== "FLAT")
    .sort((a, b) => b.confluence.total - a.confluence.total);

  const bestDirectional = directional[0]!;
  const flatScore = scored.find((s) => s.direction === "FLAT")!;

  // Choose direction: take the best directional if it passes threshold, else FLAT
  const chosen = bestDirectional.confluence.total >= CONVICTION_THRESHOLD
    ? bestDirectional
    : flatScore;

  const skipped = chosen.direction !== "FLAT" ? false : bestDirectional.confluence.total < CONVICTION_THRESHOLD;

  // For skipped (FLAT chosen due to low conviction): still compute levels for the best directional
  // so we can track what would have happened
  const trackDirection = skipped ? bestDirectional : chosen;
  const { entryPrice, compositeTarget, levels } =
    computeCompositeTarget(htfContext, trackDirection.direction);

  const id = await saveTradeIdea({
    briefId,
    asset,
    direction: trackDirection.direction,
    entryPrice,
    compositeTarget,
    levels,
    confluence: trackDirection.confluence,
    skipped,
  });

  const decision: TradeDecision = {
    direction: trackDirection.direction,
    confluence: trackDirection.confluence,
    entryPrice,
    compositeTarget,
    skipped,
    alternatives: scored
      .filter((s) => s.direction !== trackDirection.direction)
      .map((s) => ({ direction: s.direction, total: s.confluence.total })),
  };

  // ─── Console output ───────────────────────────────────────────────
  const confStr = Object.entries(trackDirection.confluence)
    .filter(([k]) => k !== "total")
    .map(([dim, score]) => {
      const s = score as number;
      const icon = s > 0 ? chalk.green(`+${s}`) : s < 0 ? chalk.red(`${s}`) : chalk.dim("0");
      return `${dim}:${icon}`;
    })
    .join("  ");

  const altStr = decision.alternatives
    .map((a) => `${a.direction}=${a.total}`)
    .join("  ");

  if (skipped) {
    console.log(
      `      ${chalk.dim("▹")} trade idea: ${chalk.bold(trackDirection.direction)} ` +
        `conviction=${trackDirection.confluence.total}/${CONVICTION_THRESHOLD} — ${chalk.yellow("SKIPPED")} (tracking)`,
    );
    console.log(`        ${confStr}`);
    console.log(`        ${chalk.dim(`alternatives: ${altStr}`)}`);
  } else {
    const targetDist = Math.abs(compositeTarget - entryPrice);
    const stops = levels
      .filter((l) => l.type === "INVALIDATION")
      .map((l) => `${l.label}@${l.price.toFixed(0)}`)
      .join(" ");
    const targets = levels
      .filter((l) => l.type === "TARGET")
      .map((l) => `${l.label}@${l.price.toFixed(0)}`)
      .join(" ");

    console.log(
      `      ${chalk.green("▸")} trade idea: ${chalk.bold(trackDirection.direction)} ` +
        `entry=${entryPrice.toFixed(0)} ` +
        `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)}) ` +
        `conviction=${chalk.bold(String(trackDirection.confluence.total))}`,
    );
    console.log(`        stops: ${stops}`);
    console.log(`        targets: ${targets}`);
    console.log(`        ${confStr}`);
    console.log(`        ${chalk.dim(`alternatives: ${altStr}`)}`);
  }

  return { id, decision };
}
