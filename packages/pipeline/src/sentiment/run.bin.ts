#!/usr/bin/env tsx
/**
 * CLI entry point for the sentiment dimension.
 *
 * Usage:
 *   pnpm sentiment
 *   pnpm sentiment --asset ETH
 */

import chalk from "chalk";
import { runSentiment } from "./run.js";
import type { AssetType } from "../types.js";

const asset = process.argv.includes("--asset")
  ? (process.argv[process.argv.indexOf("--asset") + 1] as AssetType)
  : "BTC";

runSentiment(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
