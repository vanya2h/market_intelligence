/**
 * Exchange Flows — LLM Agent (Dimension 04)
 *
 * Receives ExchangeFlowsContext and returns a short regime interpretation.
 * Response is cached by content-hash (24h TTL) so identical market
 * states don't re-invoke Claude.
 */

import crypto from "node:crypto";
import type { ExchangeFlowsContext } from "./types.js";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";

const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

function contextCacheKey(ctx: ExchangeFlowsContext): string {
  const fingerprint = {
    regime: ctx.regime,
    previousRegime: ctx.previousRegime,
    // Bucket to avoid cache misses on tiny changes
    balanceTrend: ctx.metrics.balanceTrend,
    reserveChange7dBucket: Math.round(ctx.metrics.reserveChange7dPct * 2) / 2, // 0.5% buckets
    reserveChange30dBucket: Math.round(ctx.metrics.reserveChange30dPct), // 1% buckets
    todaySigmaBucket: Math.round(ctx.metrics.todaySigma * 2) / 2, // 0.5σ buckets
    isAt30dLow: ctx.metrics.isAt30dLow,
    isAt30dHigh: ctx.metrics.isAt30dHigh,
    events: ctx.events.map((e) => e.type).sort(),
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-ef-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: ExchangeFlowsContext): Promise<string> {
  const res = await callLlm({
    system: `You are an on-chain exchange flow analyst. You receive structured exchange balance data \
for ${ctx.asset} and write a concise 2-4 sentence interpretation for a market brief.
Focus on: what the flow regime means for supply pressure (accumulation vs distribution), \
the significance of reserve trends, and any notable events (σ spikes, 30d extremes).
Be direct and specific — cite actual numbers. Do not hedge or pad.`,
    user: `Analyze this ${ctx.asset} exchange flows context:\n\n${JSON.stringify(ctx, null, 2)}`,
    maxTokens: 256,
  });
  return res.text;
}

export async function runAgent(ctx: ExchangeFlowsContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
