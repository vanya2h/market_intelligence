#!/usr/bin/env tsx
/**
 * CLI entry point for the ETF flows dimension.
 *
 * Usage:
 *   pnpm etfs
 *   pnpm etfs --asset ETH
 */

import chalk from "chalk";
import { runEtfs } from "./run.js";
import type { AssetType } from "../types.js";

const asset = process.argv.includes("--asset")
  ? (process.argv[process.argv.indexOf("--asset") + 1] as AssetType)
  : "BTC";

runEtfs(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
