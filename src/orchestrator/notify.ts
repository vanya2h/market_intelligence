/**
 * Orchestrator — Telegram Notifier
 *
 * Runs the full brief pipeline and sends the result to a Telegram channel.
 * Uses the raw Telegram Bot API via fetch — no extra dependency.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — channel or chat ID (e.g. -100xxxxx)
 *
 * Usage:
 *   pnpm notify
 *   pnpm notify --asset ETH
 */

import "dotenv/config";
import chalk from "chalk";
import { runAllDimensions } from "./pipeline.js";
import { synthesize } from "./synthesizer.js";
import type { DimensionOutput } from "./types.js";

// ─── Telegram API ────────────────────────────────────────────────────────────

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToTelegramHtml(text: string): string {
  // Escape HTML entities first
  let html = escapeHtml(text);

  // Convert markdown to HTML tags
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");

  return html;
}

function buildMessage(asset: string, outputs: DimensionOutput[], brief: string): string {
  const date = new Date().toUTCString().replace(/ GMT$/, " UTC");

  // Header
  let msg = `<b>MARKET BRIEF</b>  —  ${asset}  —  ${date}\n\n`;

  // Regime table
  msg += "<b>Dimension Regimes</b>\n";
  for (const o of outputs) {
    const label = o.label.padEnd(30);
    msg += `<code>${escapeHtml(label)}</code> ${escapeHtml(o.regime)}\n`;
  }
  msg += "\n———\n\n";

  // Brief body
  msg += markdownToTelegramHtml(brief);

  // Truncate if needed
  if (msg.length > MAX_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n<i>[truncated]</i>";
  }

  return msg;
}

async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Telegram API error ${res.status}: ${JSON.stringify(body)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

async function main(): Promise<void> {
  // Validate env vars before running the pipeline
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.error(chalk.red.bold("TELEGRAM_BOT_TOKEN is not set in .env"));
    process.exit(1);
  }
  if (!chatId) {
    console.error(chalk.red.bold("TELEGRAM_CHAT_ID is not set in .env"));
    process.exit(1);
  }

  const assets: ("BTC" | "ETH")[] = process.argv.includes("--asset")
    ? [process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH"]
    : ["BTC", "ETH"];

  for (const asset of assets) {
    step(1, 3, `Running all dimension pipelines (${asset})...`);
    const outputs = await runAllDimensions(asset);
    note(`${outputs.length} dimensions completed`);

    step(2, 3, "Synthesizing market brief...");
    const brief = await synthesize(asset, outputs);

    step(3, 3, `Sending ${asset} brief to Telegram...`);
    const message = buildMessage(asset, outputs, brief);
    note(`message length: ${message.length} chars`);

    await sendTelegram(token, chatId, message);
    console.log(`\n      ${chalk.green.bold("✓")} ${asset} brief sent to Telegram`);
  }
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
