/**
 * CLI entry point for the ETF flows dimension.
 *
 * Usage:
 *   pnpm etfs
 *   pnpm etfs --asset ETH
 */

import chalk from "chalk";
import { parseAsset } from "../scripts/utils.js";
import { runEtfs } from "./run.js";

const asset = parseAsset();

runEtfs(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
