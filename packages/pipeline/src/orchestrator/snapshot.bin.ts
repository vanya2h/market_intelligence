/**
 * Hourly snapshot entrypoint — runs collect + analyze for every dimension
 * across BTC and ETH and persists to the per-dim snapshot tables. No LLM,
 * no Telegram. Brief generation reads what this writes.
 *
 * Usage:
 *   pnpm --filter @market-intel/pipeline snapshot
 */
import chalk from "chalk";
import "../env.js";
import type { AssetType } from "../types.js";
import { snapshotAllDimensions } from "./snapshot.js";

const ASSETS: AssetType[] = ["BTC", "ETH"];

async function main(): Promise<void> {
  const start = Date.now();
  const ts = new Date();
  console.log(chalk.bold.cyan(`\nSnapshot run @ ${ts.toUTCString()}\n`));

  for (const asset of ASSETS) {
    console.log(`  ${chalk.bold(asset)}`);
    await snapshotAllDimensions(asset, ts);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(chalk.green.bold(`\nDone in ${elapsed}s\n`));
}

main().catch((e) => {
  console.error(chalk.red.bold("Snapshot run failed:"), e);
  process.exit(1);
});
