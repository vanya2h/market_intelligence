#!/usr/bin/env tsx
/**
 * CLI entry point for the exchange flows dimension.
 *
 * Usage:
 *   pnpm exchange-flows
 *   pnpm exchange-flows --asset ETH
 */

import chalk from "chalk";
import { runExchangeFlows } from "./run.js";

const asset = process.argv.includes("--asset")
  ? (process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH")
  : "BTC";

runExchangeFlows(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
