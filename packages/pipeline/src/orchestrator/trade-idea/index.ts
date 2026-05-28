/**
 * Trade Idea — Barrel Orchestrator
 *
 * Fully mechanical trade idea generation:
 * 1. Run snapshot ML model → total in -1..+1 (0 fallback if model unavailable)
 * 2. Derive direction from sign of total (positive = LONG, negative = SHORT)
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
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { extractRawFeatures } from "./extract-features.js";
import { saveTradeIdea } from "./persist.js";
import { computePositionSize, type PositionSize } from "./sizing.js";
import { type MlResult, runSnapshotMl } from "./snapshot-ml.js";

/** Result of the mechanical trade decision — passed to the synthesizer */
export interface TradeDecision {
  direction: Direction;
  /** ML aggregator total, or 0 fallback. Signed -1..+1. */
  confluenceTotal: number;
  entryPrice: number;
  compositeTarget: number;
  /** Recommended position size (% of account notional) and sizing diagnostics */
  sizing: PositionSize;
  /** ML aggregator diagnostics (modelVersion), or null if model unavailable. */
  ml: MlResult | null;
}

/**
 * Mechanically pick direction and compute the trade idea.
 * Returns the trade decision (for the synthesizer) and the persisted idea ID.
 *
 * Direction is derived from the sign of the ML total (or 0 fallback):
 *   total >= 0 → LONG, total < 0 → SHORT.
 */
export async function processTradeIdea(
  briefId: string,
  asset: $Enums.Asset,
  htfContext: HtfContext,
  outputs: DimensionOutput[],
): Promise<{ id: string; decision: TradeDecision }> {
  const rawFeatures = extractRawFeatures(outputs);

  const snapshotResult = await runSnapshotMl(asset, rawFeatures);
  const confluenceTotal = snapshotResult?.score ?? 0;
  const ml: MlResult | null = snapshotResult
    ? { mlTotal: snapshotResult.score, modelVersion: snapshotResult.modelVersion }
    : null;
  const modelStats = snapshotResult?.stats ?? null;

  const direction: Direction = confluenceTotal >= 0 ? "LONG" : "SHORT";
  const sizing = computePositionSize(Math.abs(confluenceTotal), htfContext);
  const { entryPrice, compositeTarget, levels } = computeCompositeTarget(htfContext, direction, confluenceTotal);

  const id = await saveTradeIdea({
    briefId,
    asset,
    direction,
    entryPrice,
    compositeTarget,
    levels,
    total: confluenceTotal,
    sizing,
    ml,
    modelStats,
    rawFeatures,
  });

  const decision: TradeDecision = {
    direction,
    confluenceTotal,
    entryPrice,
    compositeTarget,
    sizing,
    ml,
  };

  // ─── Console output ───────────────────────────────────────────────
  const targetDist = Math.abs(compositeTarget - entryPrice);
  const stops = levels
    .filter((l) => l.type === "INVALIDATION")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");
  const targets = levels
    .filter((l) => l.type === "TARGET")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");

  const aggLabel = ml ? chalk.magenta(`ml ${ml.modelVersion}`) : chalk.yellow("no model — score=0");

  console.log(
    `      ${chalk.green("▸")} trade idea: ${chalk.bold(direction)} ` +
      `entry=${entryPrice.toFixed(0)} ` +
      `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)}) ` +
      `total=${chalk.bold(String(confluenceTotal))} ` +
      `size=${chalk.cyan(`${sizing.positionSizePct}%`)} (${sizing.convictionMultiplier}x) ` +
      `[${aggLabel}]`,
  );
  console.log(`        stops: ${stops}`);
  console.log(`        targets: ${targets}`);

  return { id, decision };
}
