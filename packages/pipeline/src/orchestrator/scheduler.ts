// Orchestrator — Cron Scheduler
//
// Long-lived process that triggers three independent jobs:
//   - hourly snapshots (collect + analyze + persist, no LLM)
//   - briefs (read snapshots, run agents, synthesize, notify) — offset 5min
//     past the snapshot tick so the freshest snapshot row is available
//   - outcome checks (trade idea win/loss tracking)
//
// Env vars:
//   SNAPSHOT_CRON — default "0 * * * *"             (top of every hour)
//   BRIEF_CRON    — default "5 0,8,12,15,18,21 * * *" (5 min after the hour)
//   OUTCOME_CRON  — default "0 6,18 * * *"          (twice daily)
//
// Usage:
//   pnpm schedule

import chalk from "chalk";
import cron from "node-cron";
import type { AssetType } from "../types.js";
import { checkOutcomes } from "./trade-idea/outcome-checker.js";
import { runNotify } from "./notify.js";
import { snapshotAllDimensions } from "./snapshot.js";
import "../env.js";

const SNAPSHOT_CRON = process.env.SNAPSHOT_CRON ?? "0 * * * *";
const BRIEF_CRON = process.env.BRIEF_CRON ?? "5 0,8,12,15,18,21 * * *";
const OUTCOME_CRON = process.env.OUTCOME_CRON ?? "0 6,18 * * *";
const ASSETS: AssetType[] = ["BTC", "ETH"];

let runningSnapshot = false;
let running = false;
let runningOutcomes = false;
let shuttingDown = false;

// ─── Run wrappers ────────────────────────────────────────────────────────────

async function snapshotTick(): Promise<void> {
  if (runningSnapshot) {
    console.log(chalk.yellow("Previous snapshot still in progress, skipping"));
    return;
  }

  runningSnapshot = true;
  const start = Date.now();
  const ts = new Date();
  console.log(`\n${chalk.bold.white("━".repeat(62))}`);
  console.log(chalk.bold.white(`  SNAPSHOT  ${ts.toUTCString()}`));
  console.log(chalk.bold.white("━".repeat(62)));

  try {
    for (const asset of ASSETS) {
      console.log(`  ${chalk.bold(asset)}`);
      await snapshotAllDimensions(asset, ts);
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(chalk.green.bold(`\n✓ Snapshot completed in ${elapsed}s`));
  } catch (err) {
    console.error(chalk.red.bold("\n✗ Snapshot failed:"), err);
  } finally {
    runningSnapshot = false;
  }
}

async function tick(): Promise<void> {
  if (running) {
    console.log(chalk.yellow("Previous run still in progress, skipping"));
    return;
  }

  running = true;
  const start = Date.now();
  console.log(`\n${chalk.bold.white("━".repeat(62))}`);
  console.log(chalk.bold.white(`  SCHEDULED RUN  ${new Date().toUTCString()}`));
  console.log(chalk.bold.white("━".repeat(62)));

  try {
    await runNotify(ASSETS);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(chalk.green.bold(`\n✓ Run completed in ${elapsed}s`));
  } catch (err) {
    console.error(chalk.red.bold("\n✗ Run failed:"), err);
  } finally {
    running = false;
  }
}

async function outcomeTick(): Promise<void> {
  if (runningOutcomes) {
    console.log(chalk.yellow("Outcome check still in progress, skipping"));
    return;
  }

  runningOutcomes = true;
  const start = Date.now();
  console.log(`\n${chalk.bold.white("━".repeat(62))}`);
  console.log(chalk.bold.white(`  OUTCOME CHECK  ${new Date().toUTCString()}`));
  console.log(chalk.bold.white("━".repeat(62)));

  try {
    await checkOutcomes();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(chalk.green.bold(`\n✓ Outcome check completed in ${elapsed}s`));
  } catch (err) {
    console.error(chalk.red.bold("\n✗ Outcome check failed:"), err);
  } finally {
    runningOutcomes = false;
  }
}

// ─── Startup validation ─────────────────────────────────────────────────────

function validateEnv(): void {
  const required = [
    "ANTHROPIC_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "DATABASE_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(chalk.red.bold("Missing required env vars:"), missing.join(", "));
    process.exit(1);
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

// eslint-disable-next-line prefer-const
let snapshotTask!: cron.ScheduledTask;
// eslint-disable-next-line prefer-const
let briefTask!: cron.ScheduledTask;
// eslint-disable-next-line prefer-const
let outcomeTask!: cron.ScheduledTask;

function shutdown(signal: string): void {
  console.log(chalk.yellow(`\n${signal} received`));

  if (shuttingDown) return;
  shuttingDown = true;

  snapshotTask.stop();
  briefTask.stop();
  outcomeTask.stop();

  if (running || runningSnapshot) {
    console.log(chalk.yellow("Waiting for in-flight job to finish..."));
    const check = setInterval(() => {
      if (!running && !runningSnapshot) {
        clearInterval(check);
        console.log(chalk.green("Clean shutdown"));
        process.exit(0);
      }
    }, 500);
  } else {
    console.log(chalk.green("Clean shutdown"));
    process.exit(0);
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

validateEnv();

for (const [name, expr] of [
  ["SNAPSHOT_CRON", SNAPSHOT_CRON],
  ["BRIEF_CRON", BRIEF_CRON],
  ["OUTCOME_CRON", OUTCOME_CRON],
] as const) {
  if (!cron.validate(expr)) {
    console.error(chalk.red.bold(`Invalid cron expression for ${name}: "${expr}"`));
    process.exit(1);
  }
}

console.log(chalk.bold.cyan("\n  Market Intel Scheduler"));
console.log(chalk.dim(`  snapshot cron: ${SNAPSHOT_CRON}`));
console.log(chalk.dim(`  brief cron:    ${BRIEF_CRON}`));
console.log(chalk.dim(`  outcome cron:  ${OUTCOME_CRON}`));
console.log(chalk.dim(`  assets: ${ASSETS.join(", ")}`));
console.log(chalk.dim(`  started: ${new Date().toUTCString()}\n`));

snapshotTask = cron.schedule(
  SNAPSHOT_CRON,
  () => {
    snapshotTick();
  },
  { timezone: "UTC" },
);
briefTask = cron.schedule(
  BRIEF_CRON,
  () => {
    tick();
  },
  { timezone: "UTC" },
);
outcomeTask = cron.schedule(
  OUTCOME_CRON,
  () => {
    outcomeTick();
  },
  { timezone: "UTC" },
);

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(chalk.dim("  Waiting for next scheduled tick…\n"));
