/**
 * Orchestrator — Telegram Notifier
 *
 * Runs the full brief pipeline and sends the result to a Telegram channel:
 *   1. Short synthesized brief text (via sendMessage) with link to full brief
 *
 * Uses the raw Telegram Bot API via fetch — no extra dependency.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — channel or chat ID (e.g. @yourchannel)
 *   WEB_APP_URL         — base URL of the web app (e.g. https://app.example.com)
 */

import "../env.js";
import chalk from "chalk";
import { runAllDimensions } from "./pipeline.js";
import { synthesize } from "./synthesizer.js";
import { synthesizeRich } from "./rich-synthesizer.js";
import { saveBrief } from "./persist.js";
import { processTradeIdea } from "./trade-idea/index.js";
import type { HtfOutput } from "./types.js";

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

function buildTextMessage(asset: string, brief: string, briefUrl?: string): string {
  const date = new Date().toUTCString().replace(/ GMT$/, " UTC");
  let msg = `<b>${asset} MARKET BRIEF</b>  —  ${date}\n\n` + markdownToTelegramHtml(brief);

  if (briefUrl) {
    msg += `\n\n<a href="${briefUrl}">View full brief →</a>`;
  }

  if (msg.length > MAX_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_MESSAGE_LENGTH - 20) + "\n\n<i>[truncated]</i>";
  }

  return msg;
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

// ─── Logging ─────────────────────────────────────────────────────────────────

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

// ─── Core pipeline (reusable) ────────────────────────────────────────────────

export async function runNotify(assets: ("BTC" | "ETH")[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const webAppUrl = process.env.WEB_APP_URL;

  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set");

  for (const asset of assets) {
    step(1, 5, `Running all dimension pipelines (${asset})...`);
    const outputs = await runAllDimensions(asset);
    note(`${outputs.length} dimensions completed`);

    step(2, 5, "Synthesizing market brief...");
    const [brief, richBrief] = await Promise.all([
      synthesize(asset, outputs),
      synthesizeRich(asset, outputs),
    ]);
    if (richBrief) note("rich brief generated");

    step(3, 5, "Saving to database...");
    const briefId = await saveBrief(asset, brief, outputs, richBrief);
    const briefUrl = webAppUrl ? `${webAppUrl}/brief/${briefId}` : undefined;
    if (briefUrl) note(`brief URL: ${briefUrl}`);

    step(4, 5, "Extracting trade idea...");
    const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
    if (htfOut) {
      await processTradeIdea(briefId, asset, brief, htfOut.context, outputs);
    } else {
      note("skipped — no HTF output available");
    }

    step(5, 5, `Sending ${asset} to Telegram...`);
    const textMsg = buildTextMessage(asset, brief, briefUrl);
    note(`text: ${textMsg.length} chars`);
    await sendText(token, chatId, textMsg);

    console.log(`\n      ${chalk.green.bold("✓")} ${asset} brief sent to Telegram`);
  }
}
