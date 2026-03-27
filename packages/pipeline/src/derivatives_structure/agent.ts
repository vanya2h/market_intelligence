/**
 * Derivatives Structure — LLM Agent
 *
 * Receives the structured DerivativesContext and returns a short
 * interpretation — the "derivatives paragraph" for the brief.
 */

import crypto from "node:crypto";
import { DerivativesContext } from "../types.js";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";

// 24h — content-hash invalidates before this if market state changes
const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Builds a stable cache key from the parts of the context that carry
 * analytical signal. Excludes durationHours / timestamps (noisy).
 */
function contextCacheKey(ctx: DerivativesContext): string {
  const fingerprint = {
    positioning: ctx.positioning.state,
    stress: ctx.stress.state,
    oiSignal: ctx.oiSignal,
    previousPositioning: ctx.previousPositioning,
    previousStress: ctx.previousStress,
    fundingPct1m:  Math.round(ctx.signals.fundingPct1m / 5) * 5,
    liqPct1m:      Math.round(ctx.signals.liqPct1m / 10) * 10,
    oiChange24h:   Math.round(ctx.signals.oiChange24h * 100) / 100,
    liqBias:       ctx.liquidations.bias,
    events:        ctx.events.map((e) => e.type).sort(),
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-derivatives-${ctx.asset.toLowerCase()}-${hash}`;
}

async function callClaude(ctx: DerivativesContext): Promise<string> {
  const res = await callLlm({
    system: `You are a crypto derivatives analyst who works with BTC and ETH. You receive structured market data
and write a concise 2-4 sentence regime interpretation for a market brief.
The data has two independent dimensions: positioning (structural crowding) and stress (event-driven pressure).
Focus on: what the current positioning/stress combination means, what risks it implies, and what to watch next.
Be direct and specific — cite the actual numbers. Do not hedge or pad.`,
    user: `Analyze this ${ctx.asset} derivatives context:\n\n${JSON.stringify(ctx, null, 2)}`,
    maxTokens: 256,
  });
  return res.text;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runAgent(ctx: DerivativesContext): Promise<string> {
  return getCached(contextCacheKey(ctx), AGENT_CACHE_TTL, () => callClaude(ctx));
}
