/**
 * Smoke test for the ML aggregator. Calls runMlAggregator directly with synthetic
 * scores for both assets and prints the result.
 *
 * Usage:
 *   pnpm ml:smoke                              # uses confluence_<asset>_v1.onnx
 *   ML_AGGREGATOR_VERSION=v99 pnpm ml:smoke    # missing model → null + warning
 */

import chalk from "chalk";
import type { $Enums } from "../generated/prisma/client.js";
import { CONFLUENCE_DIMENSIONS, CONFLUENCE_KEY_MAP } from "../orchestrator/dimensions.js";
import { runMlAggregator } from "../orchestrator/trade-idea/ml-aggregator.js";
import "../env.js";

const SAMPLES = [
  { label: "neutral", scores: { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 } },
  { label: "bullish-mild", scores: { derivatives: 0.3, etfs: 0.2, htf: 0.4, exchangeFlows: 0.5 } },
  { label: "bearish-mild", scores: { derivatives: -0.3, etfs: -0.2, htf: -0.4, exchangeFlows: -0.5 } },
  { label: "ef-only-bullish", scores: { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0.9 } },
  { label: "extreme-bullish", scores: { derivatives: 0.9, etfs: 0.8, htf: 0.9, exchangeFlows: 0.9 } },
];

async function main() {
  console.log(chalk.bold.cyan("\n  ML Aggregator Smoke Test\n"));
  console.log(`  ML_AGGREGATOR_VERSION: ${process.env.ML_AGGREGATOR_VERSION ?? "v1 (default)"}\n`);

  for (const asset of ["BTC", "ETH"] as $Enums.Asset[]) {
    console.log(chalk.bold(`  ${asset}`));
    for (const { label, scores } of SAMPLES) {
      const heuristicTotal =
        CONFLUENCE_DIMENSIONS.reduce((sum, dim) => sum + scores[CONFLUENCE_KEY_MAP[dim]], 0) /
        CONFLUENCE_DIMENSIONS.length;
      const ml = await runMlAggregator(asset, scores);
      if (ml) {
        console.log(
          `    ${label.padEnd(16)} heuristic=${heuristicTotal.toFixed(3)}  →  mlTotal=${chalk.bold(String(ml.mlTotal))}  [${chalk.magenta(`ml ${ml.modelVersion} pWin=${ml.pWin}`)}]`,
        );
      } else {
        console.log(
          `    ${label.padEnd(16)} heuristic=${heuristicTotal.toFixed(3)}  →  mlTotal=${chalk.dim("null (fallback)")}`,
        );
      }
    }
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red("Fatal:"), err);
    process.exit(1);
  });
