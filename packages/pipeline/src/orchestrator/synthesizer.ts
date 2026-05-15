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
import { $Enums } from "../generated/prisma/client.js";
import { callLlm } from "../llm.js";
import { getCached } from "../storage/cache.js";
import type { AssetType } from "../types.js";
import type { TradeDecision } from "./trade-idea/index.js";
import type { DeltaSummary } from "./delta.js";
import { DIMENSION_LABELS, type DimensionOutput, type HtfOutput } from "./types.js";

const SYNTH_CACHE_TTL = 1 * 60 * 60 * 1000;

function buildCacheKey(asset: string, decision: TradeDecision | null): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify({ asset, decision })).digest("hex").slice(0, 12);
  return `orchestrator-${asset.toLowerCase()}-${hash}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function formatScale(output: DimensionOutput): string {
  const parts: string[] = [];

  if (output.dimension === "ETFS") {
    const f = output.context.flow;
    parts.push(`today's flow ${ordinal(f.percentile1m)} pct (30d)`);
    if (f.consecutiveInflowDays > 0) parts.push(`${f.consecutiveInflowDays}d inflow streak`);
    if (f.consecutiveOutflowDays > 0) parts.push(`${f.consecutiveOutflowDays}d outflow streak`);
  }

  if (output.dimension === "EXCHANGE_FLOWS") {
    const m = output.context.metrics;
    parts.push(`today's flow ${ordinal(m.flowPercentile1m)} pct (30d)`);
    if (m.isAt30dHigh) parts.push("reserves at 30d high");
    else if (m.isAt30dLow) parts.push("reserves at 30d low");
    const dir = m.reserveChange7dPct > 0 ? "+" : "";
    parts.push(`7d reserve ${dir}${m.reserveChange7dPct.toFixed(2)}%`);
  }

  if (output.dimension === "DERIVATIVES") {
    const c = output.context;
    parts.push(`funding ${ordinal(c.funding.percentile["1m"])} pct`);
    parts.push(`OI ${ordinal(c.openInterest.percentile["1m"])} pct`);
    parts.push(`liq ${ordinal(c.liquidations.percentile["1m"])} pct`);
  }

  if (output.dimension === "SENTIMENT") {
    const m = output.context.metrics;
    parts.push(`composite F&G ${m.compositeIndex}/100`);
    parts.push(`consensus ${m.consensusIndex > 0 ? "+" : ""}${m.consensusIndex.toFixed(0)}/100`);
    if (m.bullishRatio !== undefined) parts.push(`${Math.round(m.bullishRatio * 100)}% analysts bullish`);
  }

  return parts.length > 0 ? `[scale: ${parts.join(" | ")}]` : "";
}

export function buildPrompt(asset: AssetType, outputs: DimensionOutput[], delta: DeltaSummary | null = null): string {
  const htf = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  const priceStr = htf?.snapshotPrice
    ? `Current price: $${htf.snapshotPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "";

  const dimensionLines = outputs
    .map((o) => {
      const scale = formatScale(o);
      return `${DIMENSION_LABELS[o.dimension]} (${o.regime}): ${o.interpretation}${scale ? `\n  ${scale}` : ""}`;
    })
    .join("\n\n");

  const deltaLine = delta && delta.tier !== "low" ? `\n\nWhat changed: ${delta.changeSummary}` : "";

  return `${asset} | ${new Date().toUTCString()}
${priceStr}

${dimensionLines}${deltaLine}`;
}

export function buildSystemPrompt(isDelta: boolean = false): string {
  const deltaNote = isDelta ? `\nThis is an update — the reader saw the prior brief. Lead with what just changed.` : "";

  return `You write Telegram market updates for crypto traders. Plain English, facts only.${deltaNote}

Format:
Line 1: current price + what the asset is doing in one short sentence. Must include the price.
Then a bullet list of key facts — one fact per line, no fluff. Each bullet must include relative scale. Cover all dimensions that have something notable.

Rules:
- No headers, no bold, no emojis. Bullets use "- ".
- Plain English. No jargon without immediate explanation.
- Each bullet MUST include a relative qualifier: percentile rank ("87th percentile"), streak length ("5-day inflow streak"), or benchmark ("30-day high"). Absolute numbers alone are not enough — pair them with their relative context.
- Each dimension's data comes with a [scale: ...] line. Use those values when writing bullets.
- One bullet per dimension. Pick the single most important fact from each. Max 15 words per bullet.
- One clause per bullet. No connecting sentences between bullets.
- Never use z-scores, sigma, or standard deviations. Use plain scale instead (e.g. "30-day high", "$350M outflow", "87th percentile").
- Skip a dimension only if nothing notable happened.`;
}

async function callClaude(
  asset: $Enums.Asset,
  outputs: DimensionOutput[],
  delta: DeltaSummary | null,
): Promise<string> {
  const isDelta = delta !== null && delta.tier !== "low";
  const res = await callLlm({
    system: buildSystemPrompt(isDelta),
    user: buildPrompt(asset, outputs, delta),
    maxTokens: 650,
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
  asset: AssetType,
  outputs: DimensionOutput[],
  _decision: TradeDecision | null = null,
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
  return getCached(buildCacheKey(asset, null), SYNTH_CACHE_TTL, () => callClaude(asset, outputs, delta));
}
