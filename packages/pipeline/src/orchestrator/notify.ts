/**
 * Orchestrator — Telegram Notifier
 *
 * Runs the full brief pipeline and sends the result to a Telegram channel:
 *   1. Color-coded regime card image (via sendPhoto)
 *   2. Short synthesized brief text (via sendMessage)
 *
 * Uses the raw Telegram Bot API via fetch — no extra dependency.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — channel or chat ID (e.g. @yourchannel)
 *
 * Usage:
 *   pnpm notify
 *   pnpm notify --asset ETH
 */

import "../env.js";
import chalk from "chalk";
import { runAllDimensions } from "./pipeline.js";
import { synthesize } from "./synthesizer.js";
import { saveBrief } from "./persist.js";
import { generateCard } from "./card.js";

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
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");
  return html;
}

function buildTextMessage(asset: string, brief: string): string {
  const date = new Date().toUTCString().replace(/ GMT$/, " UTC");
  let msg = `<b>${asset} MARKET BRIEF</b>  —  ${date}\n\n` + markdownToTelegramHtml(brief);

  if (msg.length > MAX_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n<i>[truncated]</i>";
  }

  return msg;
}

async function sendPhoto(token: string, chatId: string, png: Buffer, caption?: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "brief.png");
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Telegram sendPhoto error ${res.status}: ${JSON.stringify(body)}`);
  }
}

async function sendText(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
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
    throw new Error(`Telegram sendMessage error ${res.status}: ${JSON.stringify(body)}`);
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
    step(1, 4, `Running all dimension pipelines (${asset})...`);
    const outputs = await runAllDimensions(asset);
    note(`${outputs.length} dimensions completed`);

    step(2, 4, "Synthesizing market brief...");
    const brief = await synthesize(asset, outputs);

    step(3, 5, "Saving to database...");
    await saveBrief(asset, brief, outputs);

    step(4, 5, "Generating regime card...");
    const cardPng = await generateCard(asset, outputs);
    note(`card: ${(cardPng.length / 1024).toFixed(1)} KB`);

    step(5, 5, `Sending ${asset} to Telegram...`);
    await sendPhoto(token, chatId, cardPng);
    const textMsg = buildTextMessage(asset, brief);
    note(`text: ${textMsg.length} chars`);
    await sendText(token, chatId, textMsg);

    console.log(`\n      ${chalk.green.bold("✓")} ${asset} brief sent to Telegram`);
  }
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
