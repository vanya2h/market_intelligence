/**
 * Rich Brief Synthesizer
 *
 * Second LLM call that produces a structured JSON brief with visual
 * infographic blocks. The agent chooses which block types to use
 * based on what best communicates the current market state.
 *
 * The text synthesizer produces the Telegram-friendly plain text;
 * this one produces the web dashboard infographic version.
 */

import crypto from "node:crypto";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";
import { $Enums } from "../generated/prisma/client.js";

const RICH_CACHE_TTL = 1 * 60 * 60 * 1000;

// ─── Block Type Definitions ──────────────────────────────────────────────────

/**
 * Visual block primitives that the LLM can compose into an infographic brief.
 * The renderer on the web side knows how to draw each of these.
 */
export type RichBlock =
  // ── Structural ──
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; content: string; style?: "default" | "emphasis" | "muted" }
  | { type: "divider" }
  | { type: "spacer" }

  // ── Gauges & meters ──
  | {
      type: "spectrum";
      label: string;
      value: number;
      leftLabel: string;
      rightLabel: string;
    }

  // ── Data display ──
  | {
      type: "metric_row";
      items: {
        label: string;
        value: string;
        sentiment?: "bullish" | "bearish" | "neutral";
        detail?: string;
      }[];
    }
  | {
      type: "bar_chart";
      title?: string;
      items: { label: string; value: number; maxValue?: number }[];
    }
  | {
      type: "heatmap";
      title?: string;
      cells: {
        label: string;
        value: number;
        min?: number;
        max?: number;
      }[];
    }
  | {
      type: "scorecard";
      title?: string;
      interpretation?: string;
      items: {
        label: string;
        score: number;
        maxScore?: number;
        trend?: "up" | "down" | "flat";
      }[];
    }
  // ── Contextual / editorial ──
  | {
      type: "callout";
      variant: "bullish" | "bearish" | "warning" | "info";
      title: string;
      content: string;
    }
  | {
      type: "signal";
      direction: "bullish" | "bearish" | "neutral";
      strength: number; // 1-3
      label: string;
      detail?: string;
    }
  | {
      type: "level_map";
      current: number;
      levels: {
        price: number;
        label: string;
        type: "support" | "resistance" | "target" | "stop";
      }[];
    }
  | {
      type: "regime_banner";
      regime: string;
      subtitle?: string;
      sentiment: "bullish" | "bearish" | "neutral" | "mixed";
    }
  | {
      type: "tension";
      title: string;
      left: { label: string; detail: string; sentiment: "bullish" | "bearish" | "neutral" };
      right: { label: string; detail: string; sentiment: "bullish" | "bearish" | "neutral" };
    };

export type HeadingBlock = Extract<RichBlock, { type: "heading" }>;
export type TextBlock = Extract<RichBlock, { type: "text" }>;
export type DividerBlock = Extract<RichBlock, { type: "divider" }>;
export type SpacerBlock = Extract<RichBlock, { type: "spacer" }>;
export type SpectrumBlock = Extract<RichBlock, { type: "spectrum" }>;
export type MetricRowBlock = Extract<RichBlock, { type: "metric_row" }>;
export type BarChartBlock = Extract<RichBlock, { type: "bar_chart" }>;
export type HeatmapBlock = Extract<RichBlock, { type: "heatmap" }>;
export type ScorecardBlock = Extract<RichBlock, { type: "scorecard" }>;
export type CalloutBlock = Extract<RichBlock, { type: "callout" }>;
export type SignalBlock = Extract<RichBlock, { type: "signal" }>;
export type LevelMapBlock = Extract<RichBlock, { type: "level_map" }>;
export type RegimeBannerBlock = Extract<RichBlock, { type: "regime_banner" }>;
export type TensionBlock = Extract<RichBlock, { type: "tension" }>;

export interface RichBrief {
  blocks: RichBlock[];
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const BLOCK_CATALOG = `Block types:

STRUCTURAL:
- heading: { type: "heading", text, level?: 1|2|3 }
- text: { type: "text", content, style?: "default"|"emphasis"|"muted" }
- divider: { type: "divider" }
- spacer: { type: "spacer" }

GAUGES:
- spectrum: { type: "spectrum", label, value: number, leftLabel, rightLabel }
  Slider between two extremes (Fear↔Greed, Short↔Long). For scores, percentiles, continuum values.

DATA:
- metric_row: { type: "metric_row", items: [{ label, value, sentiment?: "bullish"|"bearish"|"neutral", detail? }] }
  Row of 2-4 headline metrics with sentiment coloring.
- bar_chart: { type: "bar_chart", title?, items: [{ label, value, maxValue? }] }
  Horizontal bars for relative comparisons.
- heatmap: { type: "heatmap", title?, cells: [{ label, value, min?, max? }] }
  Colored grid for multi-factor overviews. Use ACTUAL metric values, never normalize. Set min/max to natural range (percentile: 0-100, count: 0-30, z-score: -3 to 3).
- scorecard: { type: "scorecard", title?, interpretation?, items: [{ label, score, maxScore?, trend?: "up"|"down"|"flat" }] }
  Score list with trends. Add "interpretation": 1-2 sentence takeaway highlighting divergences or key signal.

EDITORIAL:
- callout: { type: "callout", variant: "bullish"|"bearish"|"warning"|"info", title, content }
  Highlighted box for critical insights. High visual impact.
- signal: { type: "signal", direction: "bullish"|"bearish"|"neutral", strength: 1-3, label, detail? }
  Directional call with conviction level.
- level_map: { type: "level_map", current: number, levels: [{ price, label, type: "support"|"resistance"|"target"|"stop" }] }
  Price level diagram. All prices MUST be actual asset prices, never raw metrics (OI, volume, etc).
- regime_banner: { type: "regime_banner", regime, subtitle?, sentiment: "bullish"|"bearish"|"neutral"|"mixed" }
  Macro regime banner. Use as opening block.
- tension: { type: "tension", title, left: { label, detail, sentiment }, right: { label, detail, sentiment } }
  Cross-dimension conflict. Two sides pulling opposite directions.`;

function buildSystemPrompt(dimensionCount: number): string {
  return `You are a market strategist creating a visual infographic brief from ${dimensionCount} analytical dimensions.

${BLOCK_CATALOG}

RULES:
- Primary goal: detect **swing trade reversals**. Prioritize reversal signals.
- Open with regime_banner. Use 6-10 blocks total.
- Show data visually (spectrums, bar_charts, heatmaps) — don't write numbers in text blocks.
- Max 1-2 callouts for the most critical insights only.
- Use tension blocks for cross-dimension conflicts — often the most valuable signal.
- Signal strength: 3=highest confluence, 2=high conviction, 1=moderate.
- Note signal staleness when present: fresh (0-2 candles) vs fading (5+).
- Cite specific numbers. No vague statements.

OUTPUT: Return ONLY minified JSON: {"blocks":[...]}
No markdown, no explanation.`;
}

function buildUserPrompt(asset: $Enums.Asset, outputs: DimensionOutput[]): string {
  const sections = outputs.map((o) => {
    return `### ${DIMENSION_LABELS[o.dimension]}
**Regime:** ${o.regime}

**Agent interpretation:**
${o.interpretation}

**Raw context (key metrics):**
${JSON.stringify(o.context, null, 2)}`;
  });

  return `Create a visual infographic brief for ${asset} from these ${outputs.length} dimensions.
Current time: ${new Date().toUTCString()}

${sections.join("\n\n---\n\n")}`;
}

// ─── Cache key ───────────────────────────────────────────────────────────────

function buildCacheKey(asset: string, outputs: DimensionOutput[]): string {
  const fingerprint = outputs.map((o) => ({
    dim: o.dimension,
    regime: o.regime,
    interp: o.interpretation.slice(0, 100),
  }));
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ asset, fingerprint, variant: "rich" }))
    .digest("hex")
    .slice(0, 12);
  return `rich-brief-${asset.toLowerCase()}-${hash}`;
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callClaude(asset: $Enums.Asset, outputs: DimensionOutput[]): Promise<RichBrief> {
  const res = await callLlm({
    system: buildSystemPrompt(outputs.length),
    user: buildUserPrompt(asset, outputs),
    maxTokens: 2048,
  });

  if (res.stopReason !== "end_turn") {
    throw new Error(`Rich brief response truncated (stop_reason: ${res.stopReason})`);
  }

  const text = res.text;

  // Parse JSON — strip any markdown fences the model might add
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const parsed = JSON.parse(cleaned) as RichBrief;

  if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
    throw new Error("Rich brief response missing blocks array");
  }

  // Sanitize level_map blocks: remove levels with prices wildly off from current
  for (const block of parsed.blocks) {
    if (block.type === "level_map" && block.levels.length > 0) {
      const current = block.current;
      block.levels = block.levels.filter((lvl) => {
        const ratio = lvl.price / current;
        // Keep levels within 50% of current price — anything beyond is likely
        // a raw metric value (OI, volume) mistakenly used as a price
        return ratio > 0.5 && ratio < 1.5;
      });
    }
  }

  return parsed;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function synthesizeRich(asset: $Enums.Asset, outputs: DimensionOutput[]): Promise<RichBrief | null> {
  if (outputs.length === 0) return null;

  try {
    return await getCached(buildCacheKey(asset, outputs), RICH_CACHE_TTL, () => callClaude(asset, outputs));
  } catch (err) {
    // Rich brief is a nice-to-have — don't break the pipeline if it fails
    console.error("Rich brief generation failed (falling back to text-only):", err);
    return null;
  }
}
