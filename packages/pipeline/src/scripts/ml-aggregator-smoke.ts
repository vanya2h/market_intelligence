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
import { DimensionEnum } from "../orchestrator/dimensions.js";
import { getConfluenceTotal, type Confluence } from "../orchestrator/trade-idea/confluence.js";
import { runMlAggregator } from "../orchestrator/trade-idea/ml-aggregator.js";
import "../env.js";

const SAMPLES: { label: string; scores: Confluence }[] = [
  {
    label: "neutral",
    scores: {
      [DimensionEnum.DERIVATIVES]: 0,
      [DimensionEnum.ETFS]: 0,
      [DimensionEnum.HTF]: 0,
      [DimensionEnum.EXCHANGE_FLOWS]: 0,
    },
  },
  {
    label: "bullish-mild",
    scores: {
      [DimensionEnum.DERIVATIVES]: 0.3,
      [DimensionEnum.ETFS]: 0.2,
      [DimensionEnum.HTF]: 0.4,
      [DimensionEnum.EXCHANGE_FLOWS]: 0.5,
    },
  },
  {
    label: "bearish-mild",
    scores: {
      [DimensionEnum.DERIVATIVES]: -0.3,
      [DimensionEnum.ETFS]: -0.2,
      [DimensionEnum.HTF]: -0.4,
      [DimensionEnum.EXCHANGE_FLOWS]: -0.5,
    },
  },
  {
    label: "ef-only-bullish",
    scores: {
      [DimensionEnum.DERIVATIVES]: 0,
      [DimensionEnum.ETFS]: 0,
      [DimensionEnum.HTF]: 0,
      [DimensionEnum.EXCHANGE_FLOWS]: 0.9,
    },
  },
  {
    label: "extreme-bullish",
    scores: {
      [DimensionEnum.DERIVATIVES]: 0.9,
      [DimensionEnum.ETFS]: 0.8,
      [DimensionEnum.HTF]: 0.9,
      [DimensionEnum.EXCHANGE_FLOWS]: 0.9,
    },
  },
];

async function main() {
  console.log(chalk.bold.cyan("\n  ML Aggregator Smoke Test\n"));
  console.log(`  ML_AGGREGATOR_VERSION: ${process.env.ML_AGGREGATOR_VERSION ?? "v1 (default)"}\n`);

  for (const asset of ["BTC", "ETH"] as $Enums.Asset[]) {
    console.log(chalk.bold(`  ${asset}`));
    for (const { label, scores } of SAMPLES) {
      const heuristicTotal = getConfluenceTotal(scores);
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
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
