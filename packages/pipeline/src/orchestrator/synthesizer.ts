/**
 * Orchestrator — LLM Synthesizer
 *
 * Receives all dimension outputs and produces a unified market brief.
 * This is the final LLM call in the pipeline — it sees all agent
 * interpretations and deterministic contexts, and synthesizes them
 * into a scannable, opinionated brief.
 *
 * Cached by content-hash (1h TTL — shorter than dimension agents
 * since the synthesis should reflect the latest combination).
 */

import crypto from "node:crypto";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";

const SYNTH_CACHE_TTL = 1 * 60 * 60 * 1000;

function buildCacheKey(asset: string, outputs: DimensionOutput[]): string {
  const fingerprint = outputs.map((o) => ({
    dim: o.dimension,
    regime: o.regime,
    // Use first 100 chars of interpretation as a proxy for content
    interp: o.interpretation.slice(0, 100),
  }));
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ asset, fingerprint }))
    .digest("hex")
    .slice(0, 12);
  return `orchestrator-${asset.toLowerCase()}-${hash}`;
}

function buildPrompt(asset: "BTC" | "ETH", outputs: DimensionOutput[]): string {
  const sections = outputs.map((o) => {
    return `### ${DIMENSION_LABELS[o.dimension]}
**Regime:** ${o.regime}

**Agent interpretation:**
${o.interpretation}

**Raw context:**
${JSON.stringify(o.context, null, 2)}`;
  });

  return `Synthesize a market brief for ${asset} from the following ${outputs.length} dimension analyses.
Current time: ${new Date().toUTCString()}

${sections.join("\n\n---\n\n")}`;
}

async function callClaude(asset: "BTC" | "ETH", outputs: DimensionOutput[]): Promise<string> {
  const res = await callLlm({
    system: `You are a chief market strategist writing a crypto brief from ${outputs.length} analytical dimensions.
The system's primary goal is detecting **swing trade reversals** (multi-day to multi-week holds).

Produce a SHORT, punchy brief in this exact format:

**REGIME:** [one line, ~10 words — the macro picture]

**KEY TENSION:** [one line — the most important cross-dimension signal or contradiction]

**HIGHLIGHTS**
- [2-3 short bullets, one sentence each. Cite numbers. Focus on what's unusual or at extremes.]

**TRADE IDEA**
- [Directional bias in one sentence: lean long/short/flat + key level]
- [Confirmation trigger + invalidation in one sentence]

**WATCH**
- [1 bullet — what could change the picture]

## Signal Confluence Matrix — Reversal Priority

When multiple dimensions align, reversal conviction increases. Use this hierarchy:

**HIGHEST CONVICTION (cite explicitly if present):**
- Derivatives stress (CAPITULATION/UNWINDING) + futures CVD divergence = forced selling into accumulation/distribution
- Sentiment extreme (F&G < 20 or > 80) + ETF flow reversal (with ≥20% magnitude ratio) = crowd capitulation + institutional counter-flow

**HIGH CONVICTION:**
- CVD divergence (BULLISH/BEARISH) + market structure shift (HH_HL ↔ LH_LL) = volume confirms structural change
- ETF reversal + derivatives positioning extreme (CROWDED_LONG/SHORT) = institutional flow opposing crowded trade

**MODERATE CONVICTION:**
- ACCUMULATION/DISTRIBUTION regime + RSI extreme = directional pressure building in range
- Momentum divergence (price vs RSI disagreement) + volatility compression (ATR ratio < 0.7) = coiled spring setup

**Signal staleness matters:** If staleness.cvdDivergencePeak > 5 candles or staleness.rsiExtreme > 8 candles, note the signal is fading. A fresh signal (0-2 candles) is much more actionable.

Rules:
- Maximum 200 words total. Every word must earn its place.
- One sentence per bullet. No multi-sentence bullets.
- Cite specific numbers: price levels, funding rate, RSI, flow $, F&G score, reversal ratio.
- Prioritize cross-dimension confluence over individual dimension summaries.
- No emojis. No preamble. No "based on the data". Just state it.
- Trade ideas are setups worth exploring, not financial advice.`,
    user: buildPrompt(asset, outputs),
    maxTokens: 512,
  });
  return res.text;
}

export async function synthesize(asset: "BTC" | "ETH", outputs: DimensionOutput[]): Promise<string> {
  if (outputs.length === 0) {
    return "No dimension data available — all pipelines failed.";
  }
  return getCached(buildCacheKey(asset, outputs), SYNTH_CACHE_TTL, () =>
    callClaude(asset, outputs)
  );
}
