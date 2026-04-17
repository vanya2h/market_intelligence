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
import { parseAsset } from "../scripts/utils.js";

const asset = parseAsset();

runExchangeFlows(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
