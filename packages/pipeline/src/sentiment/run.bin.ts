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
import { parseAsset } from "../scripts/utils.js";

const asset = parseAsset();

runSentiment(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
