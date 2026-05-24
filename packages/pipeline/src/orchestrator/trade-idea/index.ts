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
import { CONFLUENCE_DIMENSIONS, DimensionEnum } from "../dimensions.js";
import type { DimensionOutput } from "../types.js";
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { computeConfluence, type Confluence, getConfluenceTotal } from "./confluence.js";
import { extractRawFeatures } from "./extract-features.js";
import { type IntradimMlResults, runIntradimMl } from "./intradim-ml.js";
import { type MlResult, runMlAggregator } from "./ml-aggregator.js";
import { saveTradeIdea } from "./persist.js";
import { computePositionSize, type PositionSize } from "./sizing.js";

/** Result of the mechanical trade decision — passed to the synthesizer */
export interface TradeDecision {
  direction: Direction;
  confluence: Confluence;
  /** ML aggregator total, or equal-weight fallback. Signed -1..+1. */
  confluenceTotal: number;
  entryPrice: number;
  compositeTarget: number;
  /** Recommended position size (% of account notional) and sizing diagnostics */
  sizing: PositionSize;
  /** ML aggregator diagnostics (pWin, modelVersion), or null if model unavailable. */
  ml: MlResult | null;
  /** Per-dimension L2a ML results. Missing key = heuristic was used for that dim. */
  intradimMl: IntradimMlResults;
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
  const heuristicConfluence = computeConfluence(outputs);
  const rawFeatures = extractRawFeatures(outputs);

  // L2a: per-dim ML scores replace heuristic scores where models are available
  const intradimMl = await runIntradimMl(asset, rawFeatures);
  const confluence: Confluence = {
    [DimensionEnum.DERIVATIVES]: intradimMl[DimensionEnum.DERIVATIVES]?.score ?? heuristicConfluence[DimensionEnum.DERIVATIVES],
    [DimensionEnum.ETFS]: intradimMl[DimensionEnum.ETFS]?.score ?? heuristicConfluence[DimensionEnum.ETFS],
    [DimensionEnum.HTF]: intradimMl[DimensionEnum.HTF]?.score ?? heuristicConfluence[DimensionEnum.HTF],
    [DimensionEnum.EXCHANGE_FLOWS]: intradimMl[DimensionEnum.EXCHANGE_FLOWS]?.score ?? heuristicConfluence[DimensionEnum.EXCHANGE_FLOWS],
  };

  // L1: cross-dim aggregator on the (ML-replaced) per-dim scores
  const ml = await runMlAggregator(asset, confluence);
  const confluenceTotal = ml?.mlTotal ?? getConfluenceTotal(confluence);
  const direction: Direction = confluenceTotal >= 0 ? "LONG" : "SHORT";

  const sizing = computePositionSize(confluenceTotal, htfContext);
  const { entryPrice, compositeTarget, levels } = computeCompositeTarget(htfContext, direction, confluenceTotal);

  const id = await saveTradeIdea({
    briefId,
    asset,
    direction,
    entryPrice,
    compositeTarget,
    levels,
    confluence,
    total: confluenceTotal,
    sizing,
    ml,
    intradimMl,
    rawFeatures,
  });

  const decision: TradeDecision = {
    direction,
    confluence,
    confluenceTotal,
    entryPrice,
    compositeTarget,
    sizing,
    ml,
    intradimMl,
  };

  // ─── Console output ───────────────────────────────────────────────
  const confStr = CONFLUENCE_DIMENSIONS.map((dim) => {
    const s = confluence[dim];
    const mlUsed = dim in intradimMl;
    const icon = s > 0 ? chalk.green(`+${s}`) : s < 0 ? chalk.red(`${s}`) : chalk.dim("0");
    return `${dim}:${icon}${mlUsed ? chalk.magenta("*") : ""}`;
  }).join("  ");

  const targetDist = Math.abs(compositeTarget - entryPrice);
  const stops = levels
    .filter((l) => l.type === "INVALIDATION")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");
  const targets = levels
    .filter((l) => l.type === "TARGET")
    .map((l) => `${l.label}@${l.price.toFixed(0)}`)
    .join(" ");

  const aggLabel = ml ? chalk.magenta(`ml ${ml.modelVersion} pWin=${ml.pWin}`) : chalk.yellow("equal-weight fallback");
  const mlDimCount = Object.keys(intradimMl).length;

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
  console.log(`        ${confStr}  ${chalk.dim(`(* = L2a ML, ${mlDimCount}/4 dims)`)}`);

  return { id, decision };
}
