#!/usr/bin/env tsx
/**
 * CLI entry point for the brief pipeline.
 *
 * Usage:
 *   pnpm brief
 *   pnpm brief --asset ETH
 */

import chalk from "chalk";
import { runBrief } from "./run.js";

const assets: ("BTC" | "ETH")[] = process.argv.includes("--asset")
  ? [process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH"]
  : ["BTC", "ETH"];

runBrief(assets).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
