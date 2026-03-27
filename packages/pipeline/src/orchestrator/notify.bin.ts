#!/usr/bin/env tsx
/**
 * CLI entry point for the notify pipeline.
 *
 * Usage:
 *   pnpm notify
 *   pnpm notify --asset ETH
 */

import chalk from "chalk";
import { runNotify } from "./notify.js";

const assets: ("BTC" | "ETH")[] = process.argv.includes("--asset")
  ? [process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH"]
  : ["BTC", "ETH"];

runNotify(assets).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
