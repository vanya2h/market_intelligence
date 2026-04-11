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
import { DIMENSION_LABELS, type DimensionOutput, type HtfOutput } from "./types.js";
import type { TradeDecision } from "./trade-idea/index.js";
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
  const targetDistPct = (((decision.compositeTarget - decision.entryPrice) / decision.entryPrice) * 100).toFixed(2);
  return `### Trade Decision: ${decision.direction} (conviction=${decision.confluence.total}/400, size=${decision.sizing.positionSizePct}% notional)
**Breakdown:** Deriv=${decision.confluence.derivatives}, ETFs=${decision.confluence.etfs}, HTF=${decision.confluence.htf}, Flows=${decision.confluence.exchangeFlows}
**Entry:** $${decision.entryPrice.toFixed(2)} | **Target:** $${decision.compositeTarget.toFixed(2)} (${targetDistPct}%)

State the setup and the single biggest risk.`;
}

export function buildPrompt(
  asset: "BTC" | "ETH",
  outputs: DimensionOutput[],
  decision: TradeDecision | null,
  delta: DeltaSummary | null = null,
): string {
  const richSection = `### Dimension Analysis

${outputs.map((o) => {
    let line = `**${DIMENSION_LABELS[o.dimension]}** (${o.regime}): ${o.interpretation}`;
    if (o.dimension === "HTF") {
      const b = (o as HtfOutput).context.bias;
      line += `\n  Bias scores: trend=${b.trend.toFixed(2)}, momentum=${b.momentum.toFixed(2)}, flow=${b.flow.toFixed(2)}, compression=${b.compression.toFixed(2)}, vpGravity=${b.vpGravity.toFixed(2)}, composite=${b.composite.toFixed(2)}`;
    }
    return line;
  }).join("\n\n")}`;

  const deltaSection =
    delta && delta.tier !== "low"
      ? `

---

### What changed since last brief
${delta.changeSummary}

### Metric movements (prev → curr)
${delta.dimensions
  .flatMap((d) =>
    d.topMovers.map(
      (m) => `- ${DIMENSION_LABELS[d.dimension]} / ${m.label}: ${m.prev.toFixed(2)} → ${m.curr.toFixed(2)} (z=${m.zScore.toFixed(1)})`,
    ),
  )
  .join("\n")}

IMPORTANT: Lead with what changed. Check whether these movements confirm or invalidate the catalysts from the prior brief. The reader already has context — focus on the delta.`
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
  const biasSection = decision
    ? `\n3. Trade: direction, why it works now, what price kills it.`
    : ``;

  const structure = isDelta
    ? `Structure (delta — reader saw the last brief):
1. What changed and whether it confirms or contradicts the prior setup. One paragraph, no preamble.
2. Catalyst check: for each "watch for" item from the prior brief's context, state whether it fired, partially fired, or remains pending. If the delta data shows a metric moved toward or past a threshold, call it out explicitly.${biasSection}`
    : `Structure (full brief):
1. Current state in one sentence — what the asset is doing and the dominant force behind it.
2. Catalysts: 2-3 specific things the reader should watch that would flip or strengthen the current bias. Be concrete — name the metric and the direction it needs to move (e.g. "funding flipping positive while OI stays flat would confirm longs are trapped").${biasSection}`;

  return `You write a Telegram market update for crypto traders. Short, sharp, actionable.

${structure}

Rules:
- Plain English. No jargon without immediate explanation.
- No headers, no bold, no emojis. Short paragraphs.
- Only mention price levels if they are directly tied to a catalyst (e.g. "losing $X confirms the flip"). Do not list levels for their own sake.
- 100 words max. Cut ruthlessly.
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
    maxTokens: 300,
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
