/**
 * HTF Technical Structure — LLM Agent (Dimension 07)
 *
 * Receives HtfContext and returns a concise regime interpretation.
 * Cached by content-hash (24h TTL).
 */

import crypto from "node:crypto";
import { HtfContext } from "./types.js";
import { getCached } from "../storage/cache.js";

const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

function contextCacheKey(ctx: HtfContext): string {
  const fingerprint = {
    regime: ctx.regime,
    previousRegime: ctx.previousRegime,
    crossType: ctx.ma.crossType,
    recentCross: ctx.ma.recentCross,
    structure: ctx.structure,
    // Bucket to avoid cache misses on minor price moves
    priceVsSma50Bucket:  Math.round(ctx.ma.priceVsSma50Pct  / 2) * 2,  // 2% buckets
    priceVsSma200Bucket: Math.round(ctx.ma.priceVsSma200Pct / 5) * 5,  // 5% buckets
    rsiDailyBucket: Math.round(ctx.rsi.daily / 5) * 5,                 // 5-point buckets
    rsiH4Bucket:    Math.round(ctx.rsi.h4    / 5) * 5,
    // CVD dual-window regimes + divergence for caching
    cvdFutShort:  ctx.cvd.futures.short.regime,
    cvdFutLong:   ctx.cvd.futures.long.regime,
    cvdFutDiv:    ctx.cvd.futures.divergence,
    cvdSpotShort: ctx.cvd.spot.short.regime,
    cvdSpotLong:  ctx.cvd.spot.long.regime,
    cvdSpotDiv:   ctx.cvd.spot.divergence,
    // VWAP position relative to price: above or below
    priceVsWeeklyVwap: ctx.price > ctx.vwap.weekly ? "above" : "below",
    priceVsMonthlyVwap: ctx.price > ctx.vwap.monthly ? "above" : "below",
    events: ctx.events.map((e) => e.type).sort(),
    // Staleness — bucket to avoid noisy cache misses
    staleRsi: ctx.staleness.rsiExtreme !== null ? Math.min(ctx.staleness.rsiExtreme, 10) : null,
    staleCvdDiv: ctx.staleness.cvdDivergencePeak !== null ? Math.min(ctx.staleness.cvdDivergencePeak, 10) : null,
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-htf-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: HtfContext): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a technical analyst specializing in macro crypto market structure. \
You receive computed HTF (weekly/daily) indicator data and write a concise 2-4 sentence regime interpretation for a market brief.
Focus on: what the current macro structure means, key levels that matter, and what to watch for next.
Be direct and specific — cite actual values. Do not hedge or pad.`;

  const userPrompt = `Analyze this ${ctx.asset} HTF technical context:\n\n${JSON.stringify(ctx, null, 2)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const block = message.content[0]!;
  return block.type === "text" ? block.text : "[no text response]";
}

export async function runAgent(ctx: HtfContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
