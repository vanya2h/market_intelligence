/**
 * HTF Technical Structure — LLM Agent (Dimension 07)
 *
 * Receives HtfContext and returns a concise regime interpretation.
 * Cached by content-hash (24h TTL).
 */

import crypto from "node:crypto";
import { callLlm } from "../llm.js";
import { getCached } from "../storage/cache.js";
import { HtfContext } from "./types.js";

const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

function contextCacheKey(ctx: HtfContext): string {
  const fingerprint = {
    regime: ctx.regime,
    previousRegime: ctx.previousRegime,
    crossType: ctx.ma.crossType,
    recentCross: ctx.ma.recentCross,
    structure: ctx.structure,
    // Bucket to avoid cache misses on minor price moves
    priceVsSma50Bucket: Math.round(ctx.ma.priceVsSma50Pct / 2) * 2, // 2% buckets
    priceVsSma200Bucket: Math.round(ctx.ma.priceVsSma200Pct / 5) * 5, // 5% buckets
    rsiDailyBucket: Math.round(ctx.rsi.daily / 5) * 5, // 5-point buckets
    rsiH4Bucket: Math.round(ctx.rsi.h4 / 5) * 5,
    rsiDiv: ctx.rsi.divergence,
    // MFI — volume-weighted momentum (5-point buckets like RSI)
    mfiDailyBucket: Math.round(ctx.mfi.daily / 5) * 5,
    mfiH4Bucket: Math.round(ctx.mfi.h4 / 5) * 5,
    mfiDiv: ctx.mfi.divergence,
    // Divergence confluence — mean reversion trigger
    confluenceDir: ctx.divergenceConfluence.direction,
    confluenceStrengthBucket: Math.round(ctx.divergenceConfluence.strength * 10) / 10, // 0.1 buckets
    confluenceSources: ctx.divergenceConfluence.sources.map((s) => s.indicator).sort(),
    // CVD dual-window regimes + divergence for caching
    cvdFutShort: ctx.cvd.futures.short.regime,
    cvdFutLong: ctx.cvd.futures.long.regime,
    cvdFutDiv: ctx.cvd.futures.divergence,
    cvdSpotShort: ctx.cvd.spot.short.regime,
    cvdSpotLong: ctx.cvd.spot.long.regime,
    cvdSpotDiv: ctx.cvd.spot.divergence,
    // VWAP position relative to price: above or below
    priceVsWeeklyVwap: ctx.price > ctx.vwap.weekly ? "above" : "below",
    priceVsMonthlyVwap: ctx.price > ctx.vwap.monthly ? "above" : "below",
    events: ctx.events.map((e) => e.type).sort(),
    // STH cost basis — bucket to 5% bands to avoid noisy cache misses
    sthPosition: ctx.price > ctx.sth.price ? "above" : "below",
    sthDistBucket: Math.round(ctx.sth.priceVsSthPct / 5) * 5,
    // Staleness — bucket to avoid noisy cache misses
    staleRsi: ctx.staleness.rsiExtreme !== null ? Math.min(ctx.staleness.rsiExtreme, 10) : null,
    staleMfi: ctx.staleness.mfiExtreme !== null ? Math.min(ctx.staleness.mfiExtreme, 10) : null,
    staleCvdDiv: ctx.staleness.cvdDivergencePeak !== null ? Math.min(ctx.staleness.cvdDivergencePeak, 10) : null,
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").slice(0, 12);
  return `agent-htf-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: HtfContext): Promise<string> {
  const res = await callLlm({
    system: `You are a technical analyst specializing in macro crypto market structure. \
You receive computed HTF (weekly/daily) indicator data and write a concise 2-4 sentence regime interpretation for a market brief.
Focus on: what the current macro structure means, key levels that matter, and what to watch for next.
When divergenceConfluence.strength > 0.5, lead with it — multi-indicator exhaustion is the primary mean reversion trigger. \
Call out RSI/MFI disagreement (one extreme, the other not) as a volume-confirmation mismatch worth flagging.
Be direct and specific — cite actual values. Do not hedge or pad.`,
    user: `Analyze this ${ctx.asset} HTF technical context:\n\n${JSON.stringify(ctx, null, 2)}`,
    maxTokens: 256,
  });
  return res.text;
}

export async function runAgent(ctx: HtfContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
