/**
 * Trade Idea — Barrel Orchestrator
 *
 * Fully mechanical trade idea generation:
 * 1. Score confluence for LONG and SHORT
 * 2. Pick the direction with higher total (always taken — no skipping)
 * 3. Compute position size from conviction + volatility
 * 4. Compute composite target + R:R levels from HTF context
 * 5. Always persist
 *
 * The LLM synthesizer receives our mechanical decision and describes it
 * in human-readable form — it does NOT pick the direction.
 */

import chalk from "chalk";
import type { $Enums } from "../../generated/prisma/client.js";
import type { HtfContext } from "../../htf/types.js";
import type { DimensionOutput } from "../types.js";
import { computeBias, type DirectionalBias } from "./bias.js";
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { computeConfluence, type Confluence } from "./confluence.js";
import { computeDimensionWeights, DIMENSION_KEYS, type DimensionWeights } from "./ic-weights.js";
import { saveTradeIdea } from "./persist.js";
import { computePositionSize, type PositionSize } from "./sizing.js";

/** Result of the mechanical trade decision — passed to the synthesizer */
export interface TradeDecision {
  direction: Direction;
  confluence: Confluence;
  entryPrice: number;
  compositeTarget: number;
  /** Recommended position size (% of account notional) and sizing diagnostics */
  sizing: PositionSize;
  /** Why this direction was chosen over the alternative */
  alternatives: { direction: Direction; total: number }[];
  /** Directional lean — always present */
  bias: DirectionalBias;
  /** IC-based dimension weights used for this decision */
  weights: DimensionWeights;
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
  // Compute IC-based dimension weights from historical outcomes
  const weights = await computeDimensionWeights(asset);

  // Log IC weight diagnostics
  if (weights.calibrated) {
    const wStr = DIMENSION_KEYS.map((dim) => `${dim}:${chalk.bold(String(weights[dim]))}`).join("  ");
    const icStr = DIMENSION_KEYS.map((dim) => {
      const ic = weights.ic[dim];
      const color = ic > 0.1 ? chalk.green : ic > 0 ? chalk.yellow : chalk.red;
      return `${dim}:${color(ic.toFixed(3))}`;
    }).join("  ");
    console.log(`      ${chalk.cyan("▸")} IC weights (n=${weights.sampleCount}): ${wStr}`);
    console.log(`        IC: ${icStr}`);
  } else {
    console.log(`      ${chalk.dim("▹")} IC weights: equal (${weights.sampleCount}/${20} samples, need more data)`);
  }

  // Score LONG and SHORT — always pick the winner, no skipping
  const directions: Direction[] = ["LONG", "SHORT"];
  const scored = directions.map((dir) => ({
    direction: dir,
    confluence: computeConfluence(outputs, dir, weights),
  }));

  // Compute directional bias from LONG vs SHORT scores
  const longConf = scored.find((s) => s.direction === "LONG")!.confluence;
  const shortConf = scored.find((s) => s.direction === "SHORT")!.confluence;
  const bias = computeBias(longConf, shortConf);

  // Always pick the direction with the highest total
  const chosen = scored.sort((a, b) => b.confluence.total - a.confluence.total)[0]!;

  // Compute position size from conviction + current volatility
  const sizing = computePositionSize(chosen.confluence.total, htfContext);

  const { entryPrice, compositeTarget, levels } = computeCompositeTarget(
    htfContext,
    chosen.direction,
    chosen.confluence.total,
  );

  const id = await saveTradeIdea({
    briefId,
    asset,
    direction: chosen.direction,
    entryPrice,
    compositeTarget,
    levels,
    confluence: chosen.confluence,
    sizing,
    bias,
    weights,
  });

  const decision: TradeDecision = {
    direction: chosen.direction,
    confluence: chosen.confluence,
    entryPrice,
    compositeTarget,
    sizing,
    alternatives: scored
      .filter((s) => s.direction !== chosen.direction)
      .map((s) => ({ direction: s.direction, total: s.confluence.total })),
    bias,
    weights,
  };

  // ─── Console output ───────────────────────────────────────────────
  const confStr = Object.entries(chosen.confluence)
    .filter(([k]) => k !== "total")
    .map(([dim, score]) => {
      const s = score as number;
      const icon = s > 0 ? chalk.green(`+${s}`) : s < 0 ? chalk.red(`${s}`) : chalk.dim("0");
      return `${dim}:${icon}`;
    })
    .join("  ");

  const altStr = decision.alternatives.map((a) => `${a.direction}=${a.total}`).join("  ");

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
    `      ${chalk.green("▸")} trade idea: ${chalk.bold(chosen.direction)} ` +
      `entry=${entryPrice.toFixed(0)} ` +
      `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)}) ` +
      `conviction=${chalk.bold(String(chosen.confluence.total))} ` +
      `size=${chalk.cyan(`${sizing.positionSizePct}%`)} (${sizing.convictionMultiplier}x)`,
  );
  console.log(`        stops: ${stops}`);
  console.log(`        targets: ${targets}`);
  console.log(`        ${confStr}`);
  console.log(`        ${chalk.dim(`alternatives: ${altStr}`)}`);

  return { id, decision };
}
