/**
 * CLI entry point for the derivatives structure dimension.
 *
 * Usage:
 *   pnpm derivatives
 *   pnpm derivatives ETH
 */

import chalk from "chalk";
import { parseAssetType } from "./models.js";
import { runDerivatives } from "./run.js";

const asset = parseAssetType(process.argv.find((a) => a === "ETH") ? "ETH" : "BTC");

runDerivatives(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
