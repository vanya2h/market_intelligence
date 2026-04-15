#!/usr/bin/env tsx
/**
 * CLI entry point for the HTF technical structure dimension.
 *
 * Usage:
 *   pnpm htf
 *   pnpm htf --asset ETH
 */

import chalk from "chalk";
import { runHtf } from "./run.js";
import type { AssetType } from "../types.js";

const asset = process.argv.includes("--asset")
  ? (process.argv[process.argv.indexOf("--asset") + 1] as AssetType)
  : "BTC";

runHtf(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
