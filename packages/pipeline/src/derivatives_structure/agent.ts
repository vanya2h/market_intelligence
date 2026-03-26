/**
 * Derivatives Structure — LLM Agent
 *
 * Receives the structured DerivativesContext and returns a short regime
 * interpretation — the "derivatives paragraph" for the brief.
 */

import crypto from "node:crypto";
import { DerivativesContext } from "../types.js";
import { getCached } from "../storage/cache.js";

// 24h — content-hash invalidates before this if market state changes
const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Builds a stable cache key from the parts of the context that carry
 * analytical signal. Excludes durationHours / timestamps (noisy, change
 * every run without changing the interpretation).
 */
function contextCacheKey(ctx: DerivativesContext): string {
  const fingerprint = {
    regime: ctx.regime,
    oiSignal: ctx.oiSignal,
    previousRegime: ctx.previousRegime,
    fundingPct1m: Math.round(ctx.funding.percentile["1m"] / 5) * 5,
    oiPct1m: Math.round(ctx.openInterest.percentile["1m"] / 5) * 5,
    liqPct1m: Math.round(ctx.liquidations.percentile["1m"] / 10) * 10,
    liqBias: ctx.liquidations.bias,
    ls: Math.round(ctx.longShortRatio.current * 5) / 5,
    events: ctx.events.map((e) => e.type).sort(),
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-derivatives-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: DerivativesContext): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a crypto derivatives analyst. You receive structured market data
and write a concise 2-4 sentence regime interpretation for a market brief.
Focus on: what the current regime means, what risks it implies, and what to watch for next.
Be direct and specific — cite the actual numbers. Do not hedge or pad.`;

  const userPrompt = `Analyze this BTC derivatives context:\n\n${JSON.stringify(ctx, null, 2)}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const block = message.content[0]!;
  return block.type === "text" ? block.text : "[no text response]";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runAgent(ctx: DerivativesContext): Promise<string> {
  return getCached(
    contextCacheKey(ctx),
    AGENT_CACHE_TTL,
    () => callClaude(ctx)
  );
}
