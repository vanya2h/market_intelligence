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
import { parseAsset } from "../scripts/utils.js";

const asset = parseAsset();

runHtf(asset).catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
