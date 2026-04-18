/**
 * CLI entry point for the HTF technical structure dimension.
 *
 * Usage:
 *   pnpm htf
 *   pnpm htf --asset ETH
 */

import chalk from "chalk";
import { parseAsset } from "../scripts/utils.js";
import { runHtf } from "./run.js";

const asset = parseAsset();

runHtf(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
