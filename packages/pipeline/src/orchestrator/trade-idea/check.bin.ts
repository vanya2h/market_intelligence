/**
 * CLI entry point for the outcome checker.
 *
 * Usage:
 *   pnpm check-outcomes
 */

import chalk from "chalk";
import { checkOutcomes } from "./outcome-checker.js";
import "../../env.js";

console.log(chalk.bold.cyan("\n  Trade Idea Outcome Checker\n"));

checkOutcomes()
  .then(() => {
    console.log(chalk.green.bold("\n✓ Done"));
    process.exit(0);
  })
  .catch((err) => {
    console.error(chalk.red.bold("Fatal error:"), err);
    process.exit(1);
  });
