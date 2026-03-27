#!/usr/bin/env tsx
/**
 * CLI entry point for the derivatives structure dimension.
 *
 * Usage:
 *   pnpm derivatives
 *   pnpm derivatives ETH
 */

import chalk from "chalk";
import { runDerivatives } from "./run.js";

const asset = (process.argv.find((a) => a === "ETH") ? "ETH" : "BTC") as "BTC" | "ETH";

runDerivatives(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
