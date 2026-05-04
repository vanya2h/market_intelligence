/**
 * Trade Idea — Barrel Orchestrator
 *
 * Fully mechanical trade idea generation:
 * 1. Score confluence for LONG and SHORT (heuristic per-dim + IC-weighted total)
 * 2. Run ML aggregator → mlTotal (or null if explicitly disabled, throws if broken)
 * 3. Pick the direction with higher decisionScore (mlTotal ?? total)
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
import { computeBias, type DirectionalBias } from "./bias.js";
import { computeCompositeTarget, type Direction } from "./composite-target.js";
import { computeConfluence, type Confluence, decisionScore } from "./confluence.js";
import { computeDimensionWeights, DIMENSION_KEYS, type DimensionWeights } from "./ic-weights.js";
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
  /** Why this direction was chosen over the alternative */
  alternatives: { direction: Direction; total: number }[];
  /** Directional lean — always present */
  bias: DirectionalBias;
  /** IC-based dimension weights (diagnostic — not used for aggregation when ML is on) */
  weights: DimensionWeights;
  /** ML aggregator output, or null if explicitly disabled. Throws on hard fail upstream. */
  ml: MlResult | null;
}

/**
 * Mechanically pick the best direction and compute the trade idea.
 * Returns the trade decision (for the synthesizer) and the persisted idea ID.
 *
 * If the ML aggregator can't run (missing model or inference error) it returns
 * null and a warning is logged; the trade idea proceeds using the heuristic
 * `total` via `decisionScore()`.
 */
export async function processTradeIdea(
  briefId: string,
  asset: $Enums.Asset,
  htfContext: HtfContext,
  outputs: DimensionOutput[],
): Promise<{ id: string; decision: TradeDecision }> {
  // Compute IC-based dimension weights — diagnostic / surfaced via API.
  // No longer drives aggregation when ML is on; kept for the Signals panel
  // and as a regime-drift early warning between ML retrains.
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

  // Score LONG and SHORT — always pick the winner, no skipping.
  //   - `computeConfluence` produces per-dim scores + heuristic IC-weighted `total`.
  //   - `runMlAggregator` produces `mlTotal` on success, or null if the model
  //     is unavailable (warning is logged; we silently fall back to heuristic).
  // Both totals are persisted; downstream consumers use `decisionScore()`.
  const directions: Direction[] = ["LONG", "SHORT"];
  const scored = await Promise.all(
    directions.map(async (dir) => {
      const heuristic = computeConfluence(outputs, dir, weights);
      const ml = await runMlAggregator(asset, {
        derivatives: heuristic.derivatives,
        etfs: heuristic.etfs,
        htf: heuristic.htf,
        exchangeFlows: heuristic.exchangeFlows,
      });
      const confluence: Confluence = ml ? { ...heuristic, mlTotal: ml.mlTotal } : heuristic;
      return { direction: dir, confluence, ml };
    }),
  );

  // Compute directional bias from LONG vs SHORT (uses decisionScore internally)
  const longConf = scored.find((s) => s.direction === "LONG")!.confluence;
  const shortConf = scored.find((s) => s.direction === "SHORT")!.confluence;
  const bias = computeBias(longConf, shortConf);

  // Pick the direction with the highest active decision score (mlTotal ?? total)
  const chosen = scored.sort((a, b) => decisionScore(b.confluence) - decisionScore(a.confluence))[0]!;
  const chosenScore = decisionScore(chosen.confluence);

  const sizing = computePositionSize(chosenScore, htfContext);

  const { entryPrice, compositeTarget, levels } = computeCompositeTarget(htfContext, chosen.direction, chosenScore);

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
    ml: chosen.ml,
  });

  const decision: TradeDecision = {
    direction: chosen.direction,
    confluence: chosen.confluence,
    entryPrice,
    compositeTarget,
    sizing,
    alternatives: scored
      .filter((s) => s.direction !== chosen.direction)
      .map((s) => ({ direction: s.direction, total: decisionScore(s.confluence) })),
    bias,
    weights,
    ml: chosen.ml,
  };

  // ─── Console output ───────────────────────────────────────────────
  const confStr = Object.entries(chosen.confluence)
    .filter(([k]) => k !== "total" && k !== "mlTotal")
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

  const aggLabel = chosen.ml
    ? chalk.magenta(`ml ${chosen.ml.modelVersion} pWin=${chosen.ml.pWin}`)
    : chalk.dim("heuristic");
  const totalsStr = chosen.ml
    ? `mlTotal=${chalk.bold(String(chosen.confluence.mlTotal))} (heur=${chosen.confluence.total})`
    : `total=${chalk.bold(String(chosen.confluence.total))}`;

  console.log(
    `      ${chalk.green("▸")} trade idea: ${chalk.bold(chosen.direction)} ` +
      `entry=${entryPrice.toFixed(0)} ` +
      `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)}) ` +
      `${totalsStr} ` +
      `size=${chalk.cyan(`${sizing.positionSizePct}%`)} (${sizing.convictionMultiplier}x) ` +
      `[${aggLabel}]`,
  );
  console.log(`        stops: ${stops}`);
  console.log(`        targets: ${targets}`);
  console.log(`        ${confStr}`);
  console.log(`        ${chalk.dim(`alternatives: ${altStr}`)}`);

  return { id, decision };
}
