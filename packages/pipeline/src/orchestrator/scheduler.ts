// Orchestrator — Cron Scheduler
//
// Long-lived process that triggers the brief + notify pipeline
// on a configurable cron schedule.
//
// Env vars:
//   BRIEF_CRON — cron expression (default: "0 0,8,12,15,18,21 * * *")
//   + all env vars required by notify.ts
//
// Usage:
//   pnpm schedule
//   BRIEF_CRON="0 0,8,12,15,18,21 * * *" pnpm schedule

import "../env.js";
import cron from "node-cron";
import chalk from "chalk";
import { runNotify } from "./notify.js";
import { checkOutcomes } from "./trade-idea/outcome-checker.js";

const BRIEF_CRON = process.env.BRIEF_CRON ?? "0 0,8,12,15,18,21 * * *";
const OUTCOME_CRON = process.env.OUTCOME_CRON ?? "0 6,18 * * *"; // 2x/day at 06:00 and 18:00 UTC
const ASSETS: ("BTC" | "ETH")[] = ["BTC", "ETH"];

let running = false;
let runningOutcomes = false;
let shuttingDown = false;

// ─── Run wrappers ────────────────────────────────────────────────────────────

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

let briefTask!: cron.ScheduledTask;
let outcomeTask!: cron.ScheduledTask;

function shutdown(signal: string): void {
  console.log(chalk.yellow(`\n${signal} received`));

  if (shuttingDown) return;
  shuttingDown = true;

  briefTask.stop();
  outcomeTask.stop();

  if (running) {
    console.log(chalk.yellow("Waiting for in-flight run to finish..."));
    const check = setInterval(() => {
      if (!running) {
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

if (!cron.validate(BRIEF_CRON)) {
  console.error(chalk.red.bold(`Invalid cron expression: "${BRIEF_CRON}"`));
  process.exit(1);
}

console.log(chalk.bold.cyan("\n  Market Intel Scheduler"));
console.log(chalk.dim(`  brief cron:   ${BRIEF_CRON}`));
console.log(chalk.dim(`  outcome cron: ${OUTCOME_CRON}`));
console.log(chalk.dim(`  assets: ${ASSETS.join(", ")}`));
console.log(chalk.dim(`  started: ${new Date().toUTCString()}\n`));

briefTask = cron.schedule(BRIEF_CRON, () => { tick(); }, { timezone: "UTC" });
outcomeTask = cron.schedule(OUTCOME_CRON, () => { outcomeTick(); }, { timezone: "UTC" });

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(chalk.dim("  Waiting for next scheduled tick…\n"));
