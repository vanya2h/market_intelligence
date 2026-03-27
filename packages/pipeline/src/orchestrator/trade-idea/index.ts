/**
 * Trade Idea — Barrel Orchestrator
 *
 * End-to-end trade idea extraction: direction from brief text,
 * composite target + multiple R:R levels from HTF context,
 * confluence scoring from dimension outputs, save to database.
 */

import chalk from "chalk";
import type { $Enums } from "../../generated/prisma/client.js";
import type { HtfContext } from "../../htf/types.js";
import type { DimensionOutput } from "../types.js";
import { extractDirection } from "./extractor.js";
import { computeCompositeTarget } from "./composite-target.js";
import { computeConfluence } from "./confluence.js";
import { saveTradeIdea } from "./persist.js";

/**
 * Extract direction, compute targets + confluence, and persist a trade idea.
 * Returns the trade idea ID, or null if extraction fails.
 */
export async function processTradeIdea(
  briefId: string,
  asset: $Enums.Asset,
  briefText: string,
  htfContext: HtfContext,
  outputs: DimensionOutput[],
): Promise<string | null> {
  try {
    const direction = await extractDirection(briefText);
    const { entryPrice, compositeTarget, levels } =
      computeCompositeTarget(htfContext, direction);
    const confluence = computeConfluence(outputs, direction);

    const id = await saveTradeIdea({
      briefId,
      asset,
      direction,
      entryPrice,
      compositeTarget,
      levels,
      confluence,
    });

    const targetDist = Math.abs(compositeTarget - entryPrice);
    const stops = levels
      .filter((l) => l.type === "INVALIDATION")
      .map((l) => `${l.label}@${l.price.toFixed(0)}`)
      .join(" ");
    const targets = levels
      .filter((l) => l.type === "TARGET")
      .map((l) => `${l.label}@${l.price.toFixed(0)}`)
      .join(" ");

    const conf = Object.entries(confluence)
      .map(([dim, score]) => {
        const icon = score === 1 ? chalk.green("+1") : score === -1 ? chalk.red("-1") : chalk.dim(" 0");
        return `${dim}:${icon}`;
      })
      .join("  ");

    console.log(
      `      ${chalk.green("▸")} trade idea: ${chalk.bold(direction)} ` +
        `entry=${entryPrice.toFixed(0)} ` +
        `target=${compositeTarget.toFixed(0)} (${targetDist.toFixed(0)})`,
    );
    console.log(`        stops: ${stops}`);
    console.log(`        targets: ${targets}`);
    console.log(`        confluence: ${conf}`);

    return id;
  } catch (err) {
    console.log(
      `      ${chalk.yellow("⚠")} trade idea extraction failed: ${(err as Error).message}`,
    );
    return null;
  }
}
