/**
 * Market Sentiment — LLM Agent (Dimension 06)
 *
 * Receives SentimentContext and returns a short regime interpretation.
 * Response is cached by content-hash (24h TTL) so identical market
 * states don't re-invoke Claude.
 */

import crypto from "node:crypto";
import { SentimentContext } from "./types.js";
import { getCached } from "../storage/cache.js";

const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

function contextCacheKey(ctx: SentimentContext): string {
  const fingerprint = {
    regime: ctx.regime,
    previousRegime: ctx.previousRegime,
    // Bucket to avoid cache misses on small changes
    compositeBucket: Math.round(ctx.metrics.compositeIndex / 5) * 5,   // 5-point buckets
    consensusBucket: Math.round(ctx.metrics.consensusIndex / 5) * 5,  // 5-point buckets
    zScoreBucket: Math.round(ctx.metrics.zScore * 4) / 4,            // 0.25 buckets
    divergence: ctx.metrics.divergence,
    divergenceType: ctx.metrics.divergenceType,
    events: ctx.events.map((e) => e.type).sort(),
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-sentiment-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: SentimentContext): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a market sentiment analyst specializing in crypto markets. You receive structured sentiment data including a composite Fear & Greed index (0–100, computed from derivatives positioning, HTF trend, ETF flows, and accuracy-weighted expert consensus). Write a concise 2-4 sentence interpretation for a market brief.

Focus on:
- The composite F&G score and what the component breakdown reveals
- Which components are driving the score — positioning, trend, flows, or expert consensus
- Whether any component is diverging sharply from the others (internal divergence)
- Contrarian implications at extremes

Be direct and specific — cite the composite score, component scores, and z-score. Do not hedge or pad.`;

  const userPrompt = `Analyze this ${ctx.asset} sentiment context:\n\n${JSON.stringify(ctx, null, 2)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "[no text response]";
}

export async function runAgent(ctx: SentimentContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
