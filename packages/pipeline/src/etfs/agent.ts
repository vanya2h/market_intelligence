/**
 * ETF Flows — LLM Agent (Dimension 03)
 *
 * Receives EtfContext and returns a short regime interpretation.
 * Response is cached by content-hash (24h TTL) so identical market
 * states don't re-invoke Claude.
 */

import crypto from "node:crypto";
import { EtfContext } from "./types.js";
import { getCached } from "../storage/cache.js";

const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

function contextCacheKey(ctx: EtfContext): string {
  const fingerprint = {
    regime: ctx.regime,
    previousRegime: ctx.previousRegime,
    consecutiveOutflowDays: ctx.flow.consecutiveOutflowDays,
    consecutiveInflowDays: ctx.flow.consecutiveInflowDays,
    // Bucket to avoid cache misses on tiny daily changes
    d7SumBucket: Math.round(ctx.flow.d7Sum / 1e8),      // $100M buckets
    d30SumBucket: Math.round(ctx.flow.d30Sum / 5e8),    // $500M buckets
    todaySigmaBucket: Math.round(ctx.flow.todaySigma * 2) / 2, // 0.5σ buckets
    events: ctx.events.map((e) => e.type).sort(),
    gbtcPremiumBucket:
      ctx.gbtcPremiumRate !== undefined ? Math.round(ctx.gbtcPremiumRate) : null,
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-etfs-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: EtfContext): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are an institutional market analyst. You receive structured ETF flow data \
for crypto spot ETFs and write a concise 2-4 sentence interpretation for a market brief.
Focus on: what the flow regime means for institutional demand, what the trend implies going forward, \
and any notable signals (σ events, Grayscale premium/discount).
Be direct and specific — cite actual numbers. Do not hedge or pad.`;

  const userPrompt = `Analyze this ${ctx.asset} ETF flows context:\n\n${JSON.stringify(ctx, null, 2)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const block = message.content[0]!;
  return block.type === "text" ? block.text : "[no text response]";
}

export async function runAgent(ctx: EtfContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
