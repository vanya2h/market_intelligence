/**
 * Trade Idea — Barrel Orchestrator
 *
 * Fully mechanical trade idea generation:
 * 1. Score per-dimension confluence (positive = bullish, negative = bearish)
 * 2. Run ML aggregator → total in -1..+1 (equal-weight fallback if model unavailable)
 * 3. Derive direction from sign of total (positive = LONG, negative = SHORT)
 * 4. Compute position size from conviction + volatility
 * 5. Compute composite target + R:R levels from HTF context
 * 6. Always persist
 *
 * The LLM synthesizer receives our mechanical decision and describes it
 * in human-readable form — it does NOT pick the direction.
 */

import chalk from "chalk";
import type { $Enums } from "../../generated/prisma/client.js";
import type { HtfContext } from "../../htf/types.js";
import type { DimensionOutput } from "../types.js";
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { computeConfluence, type Confluence } from "./confluence.js";
import { type MlResult, runMlAggregator } from "./ml-aggregator.js";
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
  /** ML aggregator diagnostics (pWin, modelVersion), or null if model unavailable. */
  ml: MlResult | null;
}

/** Equal-weight fallback total when the ML model is unavailable. */
function equalWeightTotal(perDim: Omit<Confluence, "total">): number {
  return (perDim.derivatives + perDim.etfs + perDim.htf + perDim.exchangeFlows) / 4;
}

/**
 * Mechanically pick direction and compute the trade idea.
 * Returns the trade decision (for the synthesizer) and the persisted idea ID.
 *
 * Direction is derived from the sign of the ML total (or fallback):
 *   total >= 0 → LONG, total < 0 → SHORT.
 */
export async function processTradeIdea(
  briefId: string,
  asset: $Enums.Asset,
  htfContext: HtfContext,
  outputs: DimensionOutput[],
): Promise<{ id: string; decision: TradeDecision }> {
  const perDim = computeConfluence(outputs);
  const ml = await runMlAggregator(asset, perDim);
  const total = ml?.mlTotal ?? equalWeightTotal(perDim);
  const confluence: Confluence = { ...perDim, total };
  const direction: Direction = total >= 0 ? "LONG" : "SHORT";

  const sizing = computePositionSize(total, htfContext);
  const { entryPrice, compositeTarget, levels } = computeCompositeTarget(htfContext, direction, total);

  const id = await saveTradeIdea({
    briefId,
    asset,
    direction,
    entryPrice,
    compositeTarget,
    levels,
    confluence,
    sizing,
    ml,
  });

  const decision: TradeDecision = {
    direction,
    confluence,
    entryPrice,
    compositeTarget,
    sizing,
    ml,
  };

  // ─── Console output ───────────────────────────────────────────────
  const dimKeys = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
  const confStr = dimKeys
    .map((k) => {
      const s = confluence[k];
      const icon = s > 0 ? chalk.green(`+${s}`) : s < 0 ? chalk.red(`${s}`) : chalk.dim("0");
      return `${k}:${icon}`;
    })
    .join("  ");

  const targetDist = Math.abs(compositeTarget - entryPrice);
  const stops = levels
    .filter((l) => l.type === "INVALIDATION")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");
  const targets = levels
    .filter((l) => l.type === "TARGET")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");

  const aggLabel = ml
    ? chalk.magenta(`ml ${ml.modelVersion} pWin=${ml.pWin}`)
    : chalk.yellow("equal-weight fallback");

  console.log(
    `      ${chalk.green("▸")} trade idea: ${chalk.bold(direction)} ` +
      `entry=${entryPrice.toFixed(0)} ` +
      `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)}) ` +
      `total=${chalk.bold(String(total))} ` +
      `size=${chalk.cyan(`${sizing.positionSizePct}%`)} (${sizing.convictionMultiplier}x) ` +
      `[${aggLabel}]`,
  );
  console.log(`        stops: ${stops}`);
  console.log(`        targets: ${targets}`);
  console.log(`        ${confStr}`);

  return { id, decision };
}
