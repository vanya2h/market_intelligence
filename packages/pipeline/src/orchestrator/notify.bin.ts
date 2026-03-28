#!/usr/bin/env tsx
/**
 * CLI entry point for the notify pipeline.
 *
 * Usage:
 *   pnpm notify                          # run full pipeline for BTC + ETH
 *   pnpm notify --asset ETH              # single asset
 *   pnpm notify --resume <runId>         # resume a failed run
 *   pnpm notify --list-failed            # show recent failed runs
 */

import chalk from "chalk";
import { runNotify, showFailedRuns } from "./notify.js";

if (process.argv.includes("--list-failed")) {
  showFailedRuns().catch((err) => {
    console.error(chalk.red.bold("Fatal error:"), err);
    process.exit(1);
  });
} else {
  const assets: ("BTC" | "ETH")[] = process.argv.includes("--asset")
    ? [process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH"]
    : ["BTC", "ETH"];

  const resume = process.argv.includes("--resume")
    ? process.argv[process.argv.indexOf("--resume") + 1]
    : undefined;

  runNotify(assets, { resume }).catch((err) => {
    console.error(chalk.red.bold("Fatal error:"), err);
    process.exit(1);
  });
}
