/**
 * Orchestrator — Resumable Notify Pipeline
 *
 * Runs the full brief pipeline and distributes to Telegram / Twitter.
 * Each run is tracked in the `notify_runs` table so that failed runs
 * can be resumed from the last successful stage via `--resume <runId>`.
 *
 * Stages: DIMENSIONS → TRADE_IDEA → SYNTHESIS → PERSIST → TELEGRAM → TWITTER
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — channel or chat ID (e.g. @yourchannel)
 *   WEB_APP_URL         — base URL of the web app (e.g. https://app.example.com)
 *   TWITTER_API_KEY     — enables Twitter posting (+ API_SECRET, ACCESS_TOKEN, ACCESS_SECRET)
 */

import "../env.js";
import chalk from "chalk";
import { runAllDimensions } from "./pipeline.js";
import { synthesize } from "./synthesizer.js";
import { synthesizeRich } from "./rich-synthesizer.js";
import { saveBrief, updateBrief } from "./persist.js";
import { processTradeIdea } from "./trade-idea/index.js";
import type { HtfOutput } from "./types.js";
import { postTweet } from "./twitter.js";
import { synthesizeTweet } from "./twitter-synthesizer.js";
import {
  type RunArtifacts,
  type NotifyStage,
  STAGES,
  createRun,
  markStageCompleted,
  markFailed,
  markCompleted,
  loadRun,
  listFailedRuns,
} from "./notify-run.js";

// ─── Telegram API ────────────────────────────────────────────────────────────

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

// ─── Logging ─────────────────────────────────────────────────────────────────

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

// ─── Stage context ──────────────────────────────────────────────────────────

interface StageCtx {
  asset: "BTC" | "ETH";
  artifacts: RunArtifacts;
  telegramEnabled: boolean;
  twitterEnabled: boolean;
  token?: string;
  chatId?: string;
  webAppUrl?: string;
}

// ─── Stage handlers ─────────────────────────────────────────────────────────

const STAGE_HANDLERS: Record<NotifyStage, (ctx: StageCtx, idx: number, total: number) => Promise<void>> = {
  async DIMENSIONS(ctx, idx, total) {
    step(idx, total, `Running all dimension pipelines (${ctx.asset})...`);
    ctx.artifacts.outputs = await runAllDimensions(ctx.asset);
    note(`${ctx.artifacts.outputs.length} dimensions completed`);
  },

  async TRADE_IDEA(ctx, idx, total) {
    step(idx, total, "Computing trade idea (mechanical)...");
    const outputs = ctx.artifacts.outputs!;
    const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");

    if (htfOut) {
      const briefId = await saveBrief(ctx.asset, "", outputs, null);
      const result = await processTradeIdea(briefId, ctx.asset, htfOut.context, outputs);
      ctx.artifacts.decision = result.decision;
      ctx.artifacts.briefId = briefId;
    } else {
      note("no HTF output — trade idea skipped");
    }
  },

  async SYNTHESIS(ctx, idx, total) {
    step(idx, total, "Synthesizing market brief...");
    const outputs = ctx.artifacts.outputs!;
    const richBrief = await synthesizeRich(ctx.asset, outputs);
    if (richBrief) note("rich brief generated");
    const briefText = await synthesize(ctx.asset, outputs, ctx.artifacts.decision ?? null, richBrief);
    note("text brief generated");
    ctx.artifacts.richBrief = richBrief;
    ctx.artifacts.briefText = briefText;
  },

  async PERSIST(ctx, idx, total) {
    step(idx, total, "Saving to database...");
    const { briefId, briefText, richBrief, outputs } = ctx.artifacts;
    if (briefId) {
      await updateBrief(briefId, briefText!, richBrief);
    } else {
      ctx.artifacts.briefId = await saveBrief(ctx.asset, briefText!, outputs!, richBrief);
    }
    ctx.artifacts.briefUrl = ctx.webAppUrl ? `${ctx.webAppUrl}/brief/${ctx.artifacts.briefId}` : undefined;
    if (ctx.artifacts.briefUrl) note(`brief URL: ${ctx.artifacts.briefUrl}`);
  },

  async TELEGRAM(ctx, idx, total) {
    if (!ctx.telegramEnabled) return;
    step(idx, total, `Sending ${ctx.asset} to Telegram...`);
    const textMsg = buildTextMessage(ctx.asset, ctx.artifacts.briefText!, ctx.artifacts.briefUrl);
    note(`text: ${textMsg.length} chars`);
    await sendText(ctx.token!, ctx.chatId!, textMsg);
    console.log(`      ${chalk.green.bold("✓")} sent to Telegram`);
  },

  async TWITTER(ctx, idx, total) {
    if (!ctx.twitterEnabled || ctx.asset !== "BTC") return;
    step(idx, total, `Synthesizing Twitter/X post (${ctx.asset})...`);
    const tweet = await synthesizeTweet(ctx.asset, ctx.artifacts.outputs!, ctx.artifacts.briefUrl);
    note(`tweet: ${tweet.length} chars`);
    const tweetId = await postTweet(tweet);
    ctx.artifacts.tweetText = tweet;
    console.log(`      ${chalk.green.bold("✓")} posted to Twitter/X (${tweetId})`);
  },
};

// ─── Public API ─────────────────────────────────────────────────────────────

export interface NotifyOptions {
  resume?: string;
}

export async function runNotify(assets: ("BTC" | "ETH")[], opts: NotifyOptions = {}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const webAppUrl = process.env.WEB_APP_URL;
  const twitterEnabled = !!process.env.TWITTER_API_KEY;
  const telegramEnabled = !!token && !!chatId;

  if (!opts.resume) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set");
  }

  // ─── Resume mode ────────────────────────────────────────────────────────
  if (opts.resume) {
    const run = await loadRun(opts.resume);
    const ageMs = Date.now() - run.createdAt.getTime();
    if (ageMs > 2 * 60 * 60 * 1000) {
      const hours = Math.round(ageMs / (60 * 60 * 1000));
      console.warn(chalk.yellow(`⚠ Run is ${hours}h old — dimension data may be stale. Use a fresh run if needed.`));
    }

    await executeStages(run.asset, run.id, run.artifacts, run.lastCompleted, {
      telegramEnabled,
      twitterEnabled,
      token,
      chatId,
      webAppUrl,
    });
    return;
  }

  // ─── Normal mode ────────────────────────────────────────────────────────
  for (const asset of assets) {
    const runId = await createRun(asset);
    console.log(chalk.dim(`\n      run: ${runId}`));

    await executeStages(asset, runId, {}, null, {
      telegramEnabled,
      twitterEnabled,
      token,
      chatId,
      webAppUrl,
    });
  }
}

export async function showFailedRuns(): Promise<void> {
  const runs = await listFailedRuns();
  if (runs.length === 0) {
    console.log(chalk.dim("No failed runs."));
    return;
  }
  console.log(chalk.bold("\nFailed runs:\n"));
  for (const r of runs) {
    const age = Math.round((Date.now() - r.createdAt.getTime()) / (60 * 1000));
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    console.log(`  ${chalk.cyan(r.id)}  ${r.asset}  stage=${chalk.red(r.failedStage ?? "?")}  ${ageStr}`);
    if (r.error) console.log(`    ${chalk.dim(r.error)}`);
  }
  console.log(chalk.dim(`\nResume with: pnpm notify --resume <runId>`));
}

// ─── Stage executor ─────────────────────────────────────────────────────────

async function executeStages(
  asset: "BTC" | "ETH",
  runId: string,
  artifacts: RunArtifacts,
  lastCompleted: NotifyStage | null,
  env: {
    telegramEnabled: boolean;
    twitterEnabled: boolean;
    token?: string;
    chatId?: string;
    webAppUrl?: string;
  },
): Promise<void> {
  const startIdx = lastCompleted ? STAGES.indexOf(lastCompleted) + 1 : 0;

  const activeStages = STAGES.filter((s) => {
    if (s === "TELEGRAM" && !env.telegramEnabled) return false;
    if (s === "TWITTER" && !env.twitterEnabled) return false;
    if (s === "TWITTER" && asset !== "BTC") return false;
    return true;
  });

  const remainingStages = activeStages.filter((s) => STAGES.indexOf(s) >= startIdx);
  const totalSteps = remainingStages.length;

  if (lastCompleted) {
    console.log(chalk.cyan(`\n      Resuming from after ${lastCompleted} (${totalSteps} stages remaining)`));
  }

  const ctx: StageCtx = {
    asset,
    artifacts,
    telegramEnabled: env.telegramEnabled,
    twitterEnabled: env.twitterEnabled,
    token: env.token,
    chatId: env.chatId,
    webAppUrl: env.webAppUrl,
  };

  let stepNum = 0;
  for (const stage of STAGES) {
    const stageIdx = STAGES.indexOf(stage);
    if (stageIdx < startIdx) continue;

    // Skip disabled stages but still mark completed
    if (!activeStages.includes(stage)) {
      await markStageCompleted(runId, stage, ctx.artifacts);
      continue;
    }

    stepNum++;
    try {
      await STAGE_HANDLERS[stage]!(ctx, stepNum, totalSteps);
      await markStageCompleted(runId, stage, ctx.artifacts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markFailed(runId, stage, msg);
      console.error(`\n      ${chalk.red.bold("✗")} ${stage} failed: ${msg}`);
      console.log(chalk.dim(`      Resume with: pnpm notify --resume ${runId}`));
      throw err;
    }
  }

  await markCompleted(runId);
  console.log(`\n      ${chalk.green.bold("✓")} ${asset} brief sent`);
}
