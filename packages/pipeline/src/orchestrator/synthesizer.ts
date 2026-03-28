/**
 * Orchestrator — Text Synthesizer (Telegram Brief)
 *
 * Takes the rich brief (infographic JSON) and the mechanical trade decision,
 * then produces a short, punchy text brief suitable for Telegram.
 *
 * The rich brief already contains all the analysis — this just condenses
 * it into a human-readable format with the trade idea appended.
 *
 * Cached by content-hash (1h TTL).
 */

import crypto from "node:crypto";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";
import type { TradeDecision } from "./trade-idea/index.js";
import { CONVICTION_THRESHOLD } from "./trade-idea/confluence.js";
import type { RichBrief } from "./rich-synthesizer.js";

const SYNTH_CACHE_TTL = 1 * 60 * 60 * 1000;

function buildCacheKey(asset: string, richBrief: RichBrief | null, decision: TradeDecision | null): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ asset, richBrief, decision }))
    .digest("hex")
    .slice(0, 12);
  return `orchestrator-${asset.toLowerCase()}-${hash}`;
}

function buildTradeSection(decision: TradeDecision | null): string {
  if (!decision) {
    return `### Trade Decision
No HTF data available — trade idea could not be computed.`;
  }
  if (decision.skipped) {
    return `### Trade Decision: SKIPPED (tracking for accuracy)
**Best direction:** ${decision.direction}
**Conviction:** ${decision.confluence.total} / ${CONVICTION_THRESHOLD} (below threshold)
**Confluence breakdown:** Derivatives=${decision.confluence.derivatives}, ETFs=${decision.confluence.etfs}, HTF=${decision.confluence.htf}, Sentiment=${decision.confluence.sentiment}
**Entry price:** $${decision.entryPrice.toFixed(2)}
**Composite target:** $${decision.compositeTarget.toFixed(2)}
**Alternatives:** ${decision.alternatives.map((a) => `${a.direction}=${a.total}`).join(", ")}

The system identified ${decision.direction} as the best directional candidate but conviction is insufficient. Explain WHY each dimension scored the way it did and what would need to change for this to become a high-conviction trade.`;
  }
  const targetDist = Math.abs(decision.compositeTarget - decision.entryPrice);
  const targetDistPct = ((decision.compositeTarget - decision.entryPrice) / decision.entryPrice * 100).toFixed(2);
  return `### Trade Decision: ${decision.direction} (conviction ${decision.confluence.total}/${CONVICTION_THRESHOLD})
**Direction:** ${decision.direction}
**Conviction:** ${decision.confluence.total} (PASSES threshold of ${CONVICTION_THRESHOLD})
**Confluence breakdown:** Derivatives=${decision.confluence.derivatives}, ETFs=${decision.confluence.etfs}, HTF=${decision.confluence.htf}, Sentiment=${decision.confluence.sentiment}
**Entry price:** $${decision.entryPrice.toFixed(2)}
**Composite target:** $${decision.compositeTarget.toFixed(2)} (${targetDistPct}%, $${targetDist.toFixed(0)} distance)
**Alternatives:** ${decision.alternatives.map((a) => `${a.direction}=${a.total}`).join(", ")}

Describe the trade setup: what's driving conviction in each dimension and what the key risk is.`;
}

export function buildPrompt(
  asset: "BTC" | "ETH",
  richBrief: RichBrief | null,
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
): string {
  const richSection = richBrief
    ? `### Rich Brief (infographic data)
${JSON.stringify(richBrief.blocks)}`
    : `### Rich Brief
Not available — using dimension interpretations as fallback.

${outputs.map((o) => `**${DIMENSION_LABELS[o.dimension]}** (${o.regime}): ${o.interpretation}`).join("\n\n")}`;

  return `Write a Telegram-friendly market brief for ${asset}.
Current time: ${new Date().toUTCString()}

${richSection}${decision && !decision.skipped ? `

---

${buildTradeSection(decision)}` : ""}`;
}

export function buildSystemPrompt(decision: TradeDecision | null): string {
  const tradeFormat = decision && !decision.skipped
    ? `**TRADE IDEA: ${decision.direction}** (conviction ${decision.confluence.total}/${CONVICTION_THRESHOLD})
- [One sentence: the primary driver — which dimensions are strongest and why]
- [One sentence: the key risk or invalidation condition]`
    : ``;

  return `You are a chief market strategist writing a short Telegram brief.
Your input is a rich infographic brief (JSON blocks) that already contains the full analysis. Your job is to condense it into a punchy text summary.
The trade decision was made mechanically. DESCRIBE it — do NOT override or suggest a different direction.

Produce a brief in this exact format:

**OVERVIEW:** [2-3 sentences — the macro picture. What regime are we in? What's the dominant theme?]

**KEY TENSION:** [one line — the single most important cross-dimension conflict or signal]

**HIGHLIGHTS**
- [3-4 short bullets. Cite numbers. Cover what's unusual or at extremes.]
- [Include key price levels the trader should watch: support, resistance, invalidation zones]
- [Flag any signals that are fresh vs fading]

${tradeFormat}

**LEVELS TO WATCH**
- [2-3 specific price levels with context: e.g. "$66,500 — SMA50 resistance, needs reclaim for bullish flip"]

Rules:
- Maximum 250 words. Every word must earn its place.
- One sentence per bullet. No multi-sentence bullets.
- Cite specific numbers from the rich brief data: prices, percentiles, scores, flows.
- Price levels are critical — the trader needs to know where the action zones are.
- The trade decision is FINAL — describe it, don't debate it.
- No emojis. No preamble. No "based on the data". Just state it.
- Trade ideas are setups, not financial advice.`;
}

async function callClaude(
  asset: "BTC" | "ETH",
  richBrief: RichBrief | null,
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
): Promise<string> {
  const res = await callLlm({
    system: buildSystemPrompt(decision),
    user: buildPrompt(asset, richBrief, outputs, decision),
    maxTokens: 512,
  });
  return res.text;
}

export async function synthesize(
  asset: "BTC" | "ETH",
  outputs: DimensionOutput[],
  decision: TradeDecision | null = null,
  richBrief: RichBrief | null = null,
): Promise<string> {
  if (outputs.length === 0) {
    return "No dimension data available — all pipelines failed.";
  }
  return getCached(buildCacheKey(asset, richBrief, decision), SYNTH_CACHE_TTL, () =>
    callClaude(asset, richBrief, outputs, decision)
  );
}
