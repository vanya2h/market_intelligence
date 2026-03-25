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
import type { DimensionOutput } from "./types.js";

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
    return `### ${o.label}
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
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are the chief market strategist synthesizing a crypto market brief from multiple specialist analysts. You receive outputs from ${outputs.length} analytical dimensions — each with a deterministic regime label and an LLM-generated interpretation.

Your job is to produce a concise, opinionated market brief that:

1. Opens with a one-line REGIME summary (the macro picture in ~10 words)
2. Has a HIGHLIGHTS section (2-4 bullet points) covering:
   - The most important thing happening right now across all dimensions
   - Any cross-dimension signals (e.g., derivatives heating up while ETFs show outflows = divergence)
   - Anything unusual or at extremes
3. Has a TRADE IDEAS section (1-3 bullet points):
   - Directional bias: does the data lean long, short, or flat? State it clearly.
   - Specific setups worth exploring: "It makes sense to look for long entries near X level" or "Short setups look attractive if Y breaks"
   - Entry context: what conditions would make the trade higher-conviction (e.g., "if ETF flows confirm with 2+ inflow days" or "on a pullback to the 50 SMA at $X")
   - Invalidation: what would kill the idea
   - Be concrete — cite price levels, indicator thresholds, or regime transitions that matter
4. Has a WATCH section (1-2 bullet points) for what could change the picture

Rules:
- Be direct and opinionated — this is intelligence for an experienced trader
- Cite specific numbers (funding rate, RSI, flow amounts, composite F&G score, price levels)
- Prioritize cross-dimension insights over repeating what individual agents said
- If dimensions contradict each other, that IS the story — highlight it
- Keep it scannable in 30 seconds
- Do NOT use emojis
- Do NOT say "based on the data" or "according to the analysis" — just state what's happening
- Trade ideas are directional leanings informed by data, not financial advice — frame them as setups worth exploring`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(asset, outputs) }],
    system: systemPrompt,
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "[no text response]";
}

export async function synthesize(asset: "BTC" | "ETH", outputs: DimensionOutput[]): Promise<string> {
  if (outputs.length === 0) {
    return "No dimension data available — all pipelines failed.";
  }
  return getCached(buildCacheKey(asset, outputs), SYNTH_CACHE_TTL, () =>
    callClaude(asset, outputs)
  );
}
