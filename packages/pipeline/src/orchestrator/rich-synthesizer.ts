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
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";

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
      items: {
        label: string;
        score: number;
        maxScore?: number;
        trend?: "up" | "down" | "flat";
      }[];
    }
  | {
      type: "comparison";
      title?: string;
      headers?: [string, string];
      rows: { label: string; a: string; b: string }[];
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
export type ComparisonBlock = Extract<RichBlock, { type: "comparison" }>;
export type CalloutBlock = Extract<RichBlock, { type: "callout" }>;
export type SignalBlock = Extract<RichBlock, { type: "signal" }>;
export type LevelMapBlock = Extract<RichBlock, { type: "level_map" }>;
export type RegimeBannerBlock = Extract<RichBlock, { type: "regime_banner" }>;
export type TensionBlock = Extract<RichBlock, { type: "tension" }>;

export interface RichBrief {
  blocks: RichBlock[];
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const BLOCK_CATALOG = `Available visual block types (use any combination):

STRUCTURAL:
- heading: { type: "heading", text: string, level?: 1|2|3 }
- text: { type: "text", content: string, style?: "default"|"emphasis"|"muted" }
- divider: { type: "divider" }
- spacer: { type: "spacer" }

GAUGES & METERS:
- spectrum: { type: "spectrum", label: string, value: number, leftLabel: string, rightLabel: string }
  A labeled slider between two extremes (e.g., Fear ←→ Greed, Short ←→ Long). Great for scores, indices, percentiles, and any value on a continuum.

DATA DISPLAY:
- metric_row: { type: "metric_row", items: [{ label, value, sentiment?: "bullish"|"bearish"|"neutral", detail? }] }
  A row of key metrics with optional sentiment coloring. Use for 2-4 headline numbers.
- bar_chart: { type: "bar_chart", title?: string, items: [{ label, value, maxValue? }] }
  Horizontal bar chart comparing values. Good for relative comparisons.
- heatmap: { type: "heatmap", title?: string, cells: [{ label, value, min?, max? }] }
  Grid of colored cells. Use for multi-dimensional overviews.
- scorecard: { type: "scorecard", title?: string, items: [{ label, score, maxScore?, trend?: "up"|"down"|"flat" }] }
  Score list with trend arrows. Good for component breakdowns.
- comparison: { type: "comparison", title?: string, headers?: [string, string], rows: [{ label, a, b }] }
  Side-by-side comparison table.

CONTEXTUAL / EDITORIAL:
- callout: { type: "callout", variant: "bullish"|"bearish"|"warning"|"info", title: string, content: string }
  A highlighted box for key insights, warnings, or trade ideas. High visual impact.
- signal: { type: "signal", direction: "bullish"|"bearish"|"neutral", strength: 1-3, label: string, detail?: string }
  A directional signal indicator with strength dots. Use for clear directional calls.
- level_map: { type: "level_map", current: number, levels: [{ price, label, type: "support"|"resistance"|"target"|"stop" }] }
  A vertical price level diagram showing key levels relative to current price.
  IMPORTANT: All "price" values MUST be actual asset price levels (e.g. 69000 for BTC). Never use raw metric values like open interest, volume, or liquidation amounts — those are NOT prices.
- regime_banner: { type: "regime_banner", regime: string, subtitle?: string, sentiment: "bullish"|"bearish"|"neutral"|"mixed" }
  A prominent banner showing the macro regime. Use as the opening block.
- tension: { type: "tension", title: string, left: { label, detail, sentiment }, right: { label, detail, sentiment } }
  Shows a cross-dimension conflict or divergence. Two sides pulling in different directions.`;

function buildSystemPrompt(dimensionCount: number): string {
  return `You are a chief market strategist creating a VISUAL market brief as a composition of infographic blocks.

You have ${dimensionCount} analytical dimensions to work with. Your job is to turn this data into a visually compelling, information-dense infographic — not a wall of text.

${BLOCK_CATALOG}

GUIDELINES:
- The system's primary goal is detecting **swing trade reversals**. Prioritize reversal signals.
- Be creative. Choose the block types that BEST communicate each insight visually.
- Start with a regime_banner to set the macro context.
- Use spectrums and bar_charts to show quantitative data — don't just write numbers in text.
- Use callouts sparingly (1-2 max) for the most critical insights or trade ideas.
- Use tension blocks when dimensions conflict — this is often the most valuable signal.
- Use level_map when price levels are relevant to the trade setup.
- Use signal blocks for clear directional calls with conviction level.
  - strength 3: highest-conviction confluence (e.g., derivatives stress + CVD divergence)
  - strength 2: high-conviction (e.g., CVD divergence + structure shift, or ETF reversal + crowded positioning)
  - strength 1: moderate (e.g., accumulation/distribution regime + RSI extreme)
- Use metric_row for headline numbers that need to be scannable.
- Use scorecard or heatmap for multi-factor overviews.
- If signal staleness data is present, note when signals are fresh (0-2 candles ago) vs fading (5+ candles).
- Aim for 6-10 blocks total. Too few = underutilizing the visual format. Too many = visual noise.
- Every block should ADD something a reader can't get from plain text.
- Cite specific numbers from the data. No vague statements.

OUTPUT FORMAT:
Return ONLY a valid **minified** JSON object (no extra whitespace or newlines) with this structure:
{"blocks":[...array of block objects...]}

No markdown fences, no explanation, no preamble. Just the compact JSON object.`;
}

function buildUserPrompt(asset: "BTC" | "ETH", outputs: DimensionOutput[]): string {
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

async function callClaude(asset: "BTC" | "ETH", outputs: DimensionOutput[]): Promise<RichBrief> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: buildUserPrompt(asset, outputs) }],
    system: buildSystemPrompt(outputs.length),
  });

  if (message.stop_reason !== "end_turn") {
    throw new Error(`Rich brief response truncated (stop_reason: ${message.stop_reason})`);
  }

  const block = message.content[0]!;
  const text = block.type === "text" ? block.text : "{}";

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

export async function synthesizeRich(
  asset: "BTC" | "ETH",
  outputs: DimensionOutput[]
): Promise<RichBrief | null> {
  if (outputs.length === 0) return null;

  try {
    return await getCached(buildCacheKey(asset, outputs), RICH_CACHE_TTL, () =>
      callClaude(asset, outputs)
    );
  } catch (err) {
    // Rich brief is a nice-to-have — don't break the pipeline if it fails
    console.error("Rich brief generation failed (falling back to text-only):", err);
    return null;
  }
}
