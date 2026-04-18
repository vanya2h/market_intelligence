/**
 * CLI entry point for the brief pipeline.
 *
 * Usage:
 *   pnpm brief
 *   pnpm brief --asset ETH
 */

import chalk from "chalk";
import { parseAsset } from "../scripts/utils.js";
import type { AssetType } from "../types.js";
import { runBrief } from "./run.js";

const assets: AssetType[] = process.argv.includes("--asset") ? [parseAsset()] : ["BTC", "ETH"];

runBrief(assets).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
