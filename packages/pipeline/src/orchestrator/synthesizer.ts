/**
 * Orchestrator — Text Synthesizer (Telegram Brief)
 *
 * Takes the rich brief (infographic JSON) and the mechanical trade decision,
 * then produces a short, punchy text brief suitable for Telegram.
 *
 * The rich brief already contains all the analysis — this just condenses
 * it into a human-readable format with the trade idea appended.
 *
 * Delta-aware: when nothing meaningful changed since the last brief,
 * returns a deterministic one-liner instead of calling the LLM.
 * When changes are moderate, the LLM prompt is augmented with a delta
 * summary so it leads with what actually changed.
 *
 * Cached by content-hash (1h TTL).
 */

import crypto from "node:crypto";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";
import type { TradeDecision } from "./trade-idea/index.js";
import { CONVICTION_THRESHOLD } from "./trade-idea/confluence.js";
import { $Enums } from "../generated/prisma/client.js";
import type { DeltaSummary } from "./delta.js";

const SYNTH_CACHE_TTL = 1 * 60 * 60 * 1000;

function buildCacheKey(asset: string, decision: TradeDecision | null): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify({ asset, decision })).digest("hex").slice(0, 12);
  return `orchestrator-${asset.toLowerCase()}-${hash}`;
}

function buildTradeSection(decision: TradeDecision | null): string {
  if (!decision) {
    return `### Trade Decision
No HTF data available — trade idea could not be computed.`;
  }
  if (decision.skipped) {
    const { bias } = decision;
    const gapAbs = Math.abs(bias.convictionGap);
    const gapDir = bias.convictionGap < 0 ? "below" : "above";
    const factorsStr = bias.topFactors.length > 0
      ? bias.topFactors.map((f) => `${f.dimension} (+${f.score})`).join(", ")
      : "none — signals balanced";
    return `### Trade Decision: SKIPPED — directional bias ${bias.lean} (${bias.strength}/100 strength)
**Best direction:** ${decision.direction}
**Conviction:** ${decision.confluence.total} / ${CONVICTION_THRESHOLD} (${gapAbs} pts ${gapDir} threshold)
**Confluence breakdown:** Derivatives=${decision.confluence.derivatives}, ETFs=${decision.confluence.etfs}, HTF=${decision.confluence.htf}, ExchangeFlows=${decision.confluence.exchangeFlows}, Sentiment=${decision.confluence.sentiment}
**Directional bias:** ${bias.lean} (strength ${bias.strength}/100)
**Key bias drivers:** ${factorsStr}
**Entry price:** $${decision.entryPrice.toFixed(2)}
**Composite target:** $${decision.compositeTarget.toFixed(2)}

The system identified a ${bias.lean} bias at ${bias.strength}/100 strength but conviction is insufficient to trade. Lead with what this directional lean means for price action in the near term. Then explain what would push conviction above threshold.`;
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
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
  delta: DeltaSummary | null = null,
): string {
  const richSection = `### Dimension Analysis

${outputs.map((o) => `**${DIMENSION_LABELS[o.dimension]}** (${o.regime}): ${o.interpretation}`).join("\n\n")}`;

  const deltaSection =
    delta && delta.tier !== "low"
      ? `

---

### What changed since last brief
${delta.changeSummary}

IMPORTANT: Lead your brief with what changed. The reader saw the previous brief — don't repeat unchanged context. Focus on the delta.`
      : "";

  return `Write a Telegram-friendly market brief for ${asset}.
Current time: ${new Date().toUTCString()}

${richSection}${deltaSection}${
    decision
      ? `

---

${buildTradeSection(decision)}`
      : ""
  }`;
}

export function buildSystemPrompt(decision: TradeDecision | null, isDelta: boolean = false): string {
  const tradeSection = decision
    ? decision.skipped
      ? `\n4. End with the directional bias: which way the market is leaning, what's driving it, and what would need to change to confirm a trade.`
      : `\n4. End with the trade idea: direction, why the setup makes sense right now, and what price proves it wrong.`
    : ``;

  const structure = isDelta
    ? `Structure (delta update — reader already saw the last brief):
1. Cold start — open directly with the change itself. No setup, no preamble. "Funding just flipped positive while OI is thinning — longs are paying to stay in a shrinking crowd." One sentence, no fluff.
2. What does this change do to the current setup? Does it strengthen the existing move, contradict it, open a new scenario? One tight paragraph.
3. Only list levels affected by the change. Skip anything that hasn't moved since the last brief.${tradeSection}`
    : `Structure (full brief — no recent context):
1. Open with what the asset is doing right now and the key price level (e.g. "BTC sitting at $87k after getting rejected — sellers still in control").
2. Explain WHY in plain English. What's driving it? Connect the dots — cause and effect, not a list of signals.
3. Close with 2-3 key levels and a short "why it matters" for each.${tradeSection}`;

  return `You write a Telegram market update for crypto traders. They want a quick, clear read on what's happening — write like you're explaining it to a smart friend, not filing a report.

${structure}

Rules:
- Every sentence must be immediately understandable. No jargon without explanation.
- BAD: "OI delta at 85th percentile with negative funding divergence" — meaningless without context.
- GOOD: "traders piling into longs while spot buyers disappear — that gap usually gets closed violently."
- Use exact prices only for key levels. Everything else: describe what it means, not the number.
- No headers. No bold. Short paragraphs. Key levels at the end as a bullet list only (e.g. "• $65,500 — first support, losing it opens $63k").
- Don't use emojis
- 150 words max — count before you finish. If you're over, cut the weakest sentence. Do not truncate mid-thought.
- The trade decision (if present) is mechanical output — describe it, don't override it.`;
}

async function callClaude(
  asset: $Enums.Asset,
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
  delta: DeltaSummary | null,
): Promise<string> {
  const isDelta = delta !== null && delta.tier !== "low";
  const res = await callLlm({
    system: buildSystemPrompt(decision, isDelta),
    user: buildPrompt(asset, outputs, decision, delta),
    maxTokens: 450,
  });
  return res.text;
}

/**
 * Build a deterministic one-liner for the "low" significance tier.
 * No LLM call — just states that nothing dramatic changed and
 * highlights the most significant current tension.
 */
function buildOneLiner(asset: string, delta: DeltaSummary, outputs: DimensionOutput[]): string {
  const htf = outputs.find((o) => o.dimension === "HTF");
  const priceStr =
    htf && "snapshotPrice" in htf && htf.snapshotPrice
      ? ` at $${htf.snapshotPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : "";

  const tension = delta.topTension ? ` ${delta.topTension}.` : "";

  return `${asset}${priceStr} — no dramatic changes since last brief.${tension}`;
}

export async function synthesize(
  asset: "BTC" | "ETH",
  outputs: DimensionOutput[],
  decision: TradeDecision | null = null,
  delta: DeltaSummary | null = null,
): Promise<string> {
  if (outputs.length === 0) {
    return "No dimension data available — all pipelines failed.";
  }

  // Low significance → deterministic one-liner, skip LLM
  if (delta && delta.tier === "low") {
    return buildOneLiner(asset, delta, outputs);
  }

  // High or medium significance → LLM call (medium injects delta into prompt)
  return getCached(buildCacheKey(asset, decision), SYNTH_CACHE_TTL, () => callClaude(asset, outputs, decision, delta));
}
