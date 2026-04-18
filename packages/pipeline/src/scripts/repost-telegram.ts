/**
 * Re-synthesize Telegram brief and post it — skips dimensions, trade idea,
 * rich synthesis, and persist. Loads existing run artifacts from the DB.
 *
 * Usage: tsx src/scripts/repost-telegram.ts <runId> [<runId2> ...]
 */
import chalk from "chalk";
import { callLlm } from "../llm.js";
import { loadRun } from "../orchestrator/notify-run.js";
import { synthesize } from "../orchestrator/synthesizer.js";
import { buildPrompt, buildSystemPrompt } from "../orchestrator/synthesizer.js";
import "../env.js";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

async function main() {
  const runIds = process.argv.slice(2);
  if (runIds.length === 0) {
    console.error("Usage: tsx src/scripts/repost-telegram.ts <runId> [<runId2> ...]");
    process.exit(1);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const webAppUrl = process.env.WEB_APP_URL;
  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
    process.exit(1);
  }

  for (const runId of runIds) {
    console.log(`\n${chalk.cyan.bold("▸")} Loading run ${chalk.cyan(runId)}...`);
    const run = await loadRun(runId);
    const { outputs, decision, richBrief, briefUrl } = run.artifacts;

    if (!outputs || outputs.length === 0) {
      console.error(chalk.red(`  ✗ Run has no dimension outputs — cannot re-synthesize`));
      continue;
    }

    console.log(`  ${run.asset} · ${outputs.length} dimensions · decision=${decision?.direction ?? "none"}`);

    // Re-synthesize (bypasses cache — calls LLM directly)
    console.log(`  Synthesizing new Telegram brief...`);
    const start = Date.now();
    const res = await callLlm({
      system: buildSystemPrompt(decision ?? null),
      user: buildPrompt(run.asset, outputs, decision ?? null),
      maxTokens: 350,
    });
    if (res.stopReason !== "end_turn") {
      console.warn(
        chalk.yellow(`  ⚠ Response truncated (stop_reason: ${res.stopReason}) — consider increasing maxTokens`),
      );
    }
    const briefText = res.text;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ${chalk.dim(`${briefText.split(/\s+/).length} words · ${briefText.length} chars · ${elapsed}s`)}`);

    // Post to Telegram
    const url = briefUrl ?? (webAppUrl ? `${webAppUrl}/brief/${run.artifacts.briefId}` : undefined);
    const textMsg = buildTextMessage(run.asset, briefText, url);
    console.log(`  Sending to Telegram...`);
    await sendText(token, chatId, textMsg);
    console.log(`  ${chalk.green.bold("✓")} Sent to Telegram`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
