/**
 * Derivatives Structure — LLM Agent (Mock)
 *
 * Receives the structured DerivativesContext and returns a short regime
 * interpretation — the "derivatives paragraph" for the brief.
 *
 * Mock mode: returns a hardcoded interpretation based on the regime.
 * To enable the real Claude call, set ANTHROPIC_API_KEY in .env and
 * change USE_MOCK to false (or remove it once ready).
 */

import crypto from "node:crypto";
import { DerivativesContext } from "../types.js";
import { getCached } from "../storage/cache.js";

const USE_MOCK = false;

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
    fundingPct1m: ctx.funding.percentile["1m"],
    oiPct1m: ctx.openInterest.percentile["1m"],
    liqPct1m: ctx.liquidations.percentile["1m"],
    liqBias: ctx.liquidations.bias,
    ls: parseFloat(ctx.longShortRatio.current.toFixed(2)),
    events: ctx.events.map((e) => e.type).sort(),
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 12);
  return `agent-derivatives-${ctx.asset.toLowerCase()}-${hash}`;
}

// ─── Mock interpretations per regime ────────────────────────────────────────

const MOCK_INTERPRETATIONS: Record<string, (ctx: DerivativesContext) => string> = {
  CROWDED_LONG: (ctx) =>
    `BTC derivatives are in a crowded long regime (${ctx.durationHours}h). ` +
    `Funding at ${ctx.funding.current.toFixed(3)}% is in the ${ctx.funding.percentile["1m"]}th percentile for the month, ` +
    `with L/S ratio at ${ctx.longShortRatio.current.toFixed(2)} — well above the 2.0 crowding threshold. ` +
    `Longs are paying a premium to stay open. Any downside catalyst risks a liquidation cascade; ` +
    `watch for an OI drop as the first warning sign of unwind.`,

  CROWDED_SHORT: (ctx) =>
    `BTC derivatives show extreme short crowding (${ctx.durationHours}h). ` +
    `Funding has turned deeply negative (${ctx.funding.percentile["1m"]}th percentile), ` +
    `L/S ratio at ${ctx.longShortRatio.current.toFixed(2)} signals heavy short positioning. ` +
    `Short squeeze risk is elevated — a move above local resistance could trigger rapid forced covering.`,

  HEATING_UP: (ctx) =>
    `BTC derivatives are heating up — funding at ${ctx.funding.percentile["1m"]}th percentile ` +
    `with L/S ${ctx.longShortRatio.current.toFixed(2)}. Not yet crowded but directional bias is building. ` +
    `Monitor for the next leg: either regime shifts to CROWDED_LONG or OI stalls and reverts.`,

  UNWINDING: (ctx) =>
    `Derivatives are unwinding. OI is declining and liquidations are elevated ` +
    `(${ctx.liquidations.percentile["1m"]}th percentile). ` +
    `Longs are being flushed — ${ctx.liquidations.bias} of liquidation volume is long-side. ` +
    `Regime likely transitioning; watch for capitulation or stabilization at support.`,

  DELEVERAGING: (_ctx) =>
    `Market is in a deleveraging phase. Funding has been persistently negative with OI declining — ` +
    `shorts are exiting rather than new longs being added. This is orderly reduction of leverage, ` +
    `not a panic. Price impact is typically gradual unless OI accelerates lower.`,

  CAPITULATION: (ctx) =>
    `Capitulation event detected. Liquidations at ${ctx.liquidations.percentile["1m"]}th percentile ` +
    `with OI collapsing. Forced exits are dominant. Historically these mark short-term bottoms ` +
    `but require stabilization confirmation — watch for OI floor and funding normalization.`,

  SHORT_SQUEEZE: (ctx) =>
    `Short squeeze in progress. Funding is reversing rapidly from negative territory, ` +
    `L/S at ${ctx.longShortRatio.current.toFixed(2)} shows shorts being squeezed. ` +
    `Momentum is upward but be aware this can reverse sharply once short covering exhausts.`,

  NEUTRAL: (ctx) =>
    `BTC derivatives are in a neutral positioning regime. ` +
    `Funding at ${ctx.funding.current.toFixed(3)}% (${ctx.funding.percentile["1m"]}th percentile), ` +
    `L/S at ${ctx.longShortRatio.current.toFixed(2)} — no strong directional bias. ` +
    `No immediate squeeze or cascade risk; market is digesting recent moves.`,
};

// ─── Real Claude call (disabled in mock mode) ────────────────────────────────

async function callClaude(ctx: DerivativesContext): Promise<string> {
  // Dynamic import so the SDK isn't loaded when mock mode is on
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
  if (USE_MOCK) {
    const fn = MOCK_INTERPRETATIONS[ctx.regime];
    return fn ? fn(ctx) : `Regime: ${ctx.regime}. No interpretation available.`;
  }
  return getCached(
    contextCacheKey(ctx),
    AGENT_CACHE_TTL,
    () => callClaude(ctx)
  );
}
