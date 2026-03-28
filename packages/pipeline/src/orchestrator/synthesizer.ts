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
import { $Enums } from "../generated/prisma/client.js";

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
  const targetDistPct = (((decision.compositeTarget - decision.entryPrice) / decision.entryPrice) * 100).toFixed(2);
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

${richSection}${
    decision && !decision.skipped
      ? `

---

${buildTradeSection(decision)}`
      : ""
  }`;
}

export function buildSystemPrompt(decision: TradeDecision | null): string {
  const tradeSection =
    decision && !decision.skipped
      ? `\n4. End with the trade idea: what direction, why it makes sense given the above, and what price would prove it wrong.`
      : ``;

  return `You write a short Telegram market update. Your audience is crypto traders who want a quick, clear read on what's happening and what to watch.

Your input is a rich infographic brief (JSON blocks) with the full analysis. Your job is to distill it into something a human actually wants to read.

Structure:
1. Open with what the asset is doing right now and the key price level (e.g. "BTC sitting at $87k after getting rejected — sellers still in control here")
2. Explain WHY in plain English — what's driving the move? Connect the dots between signals. Use cause-and-effect, not lists of metrics.
3. Close with what comes next — what level or event decides the next move? Give 2-3 key prices with a short "why it matters" for each.${tradeSection}

Clarity rules:
- Tone: clear and direct, like a senior analyst briefing a peer. Not casual ("here's the story"), not robotic. State what's happening and why — no filler transitions.
- BAD: "OI delta at 85th percentile with negative funding divergence" — what does this mean?
- GOOD: "traders are piling into new positions but paying to be short — that mismatch often triggers a squeeze"
- Use exact prices for levels. For everything else, describe what it means rather than citing the number.
- No jargon without context. If you mention funding rate, say what it implies. If you mention flows, say what the positioning tells us.
- Maximum 100 words. Short paragraphs. No headers, no bold formatting. The only exception: key levels at the end should be a bullet list (e.g. "• $65,500 — first support, losing it opens $63k").
- You can use emojis if it makes your message more readable.
- The trade decision (if present) was made mechanically — describe it, don't override it. Trade ideas are setups, not financial advice.`;
}

async function callClaude(
  asset: $Enums.Asset,
  richBrief: RichBrief | null,
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
): Promise<string> {
  const res = await callLlm({
    system: buildSystemPrompt(decision),
    user: buildPrompt(asset, richBrief, outputs, decision),
    maxTokens: 350,
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
    callClaude(asset, richBrief, outputs, decision),
  );
}
