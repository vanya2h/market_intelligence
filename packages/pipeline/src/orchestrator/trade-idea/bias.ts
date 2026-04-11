/**
 * Directional Bias
 *
 * Derived from already-computed LONG/SHORT confluence scores.
 * Answers: "which way is this range likely to resolve, and how strongly?"
 *
 * This is a runtime computation — not persisted. Additive: the trade signal
 * system (position sizing) is unchanged.
 */

import type { Confluence } from "./confluence.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Lean direction. NEUTRAL = signals are balanced, no edge detected. */
export type BiasDirection = "LONG" | "SHORT" | "NEUTRAL";

/** A dimension actively supporting the lean */
export interface BiasFactor {
  dimension: keyof Omit<Confluence, "total">;
  /** Score of the lean direction in this dimension (always > 0) */
  score: number;
}

export interface DirectionalBias {
  /** Which way the market is leaning */
  lean: BiasDirection;
  /**
   * Strength of the lean: 0..1 (UI displays as a percentage).
   * Derived from the margin between LONG total and SHORT total, normalized
   * against a practical max margin of 2 (since each total ∈ [-1, +1]).
   * 0 = perfectly balanced. 1 = all dimensions aligned with one side.
   */
  strength: number;
  /**
   * Top 1–3 dimensions driving the lean (positive score for the lean direction).
   * Per-dim scores are in 0..1. Empty when lean is NEUTRAL.
   */
  topFactors: BiasFactor[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Practical normalizer for the LONG-minus-SHORT margin.
 * Each total ∈ [-1, +1], so margin ∈ [-2, +2]. strength = |margin| / 2 ∈ [0, 1].
 * 1 is reached when one direction is fully positive and the other fully negative.
 */
const MAX_MARGIN = 2;

/** Dead-zone: margins within ±0.025 are treated as NEUTRAL to filter noise. */
const LEAN_DEAD_ZONE = 0.025;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute directional bias from already-scored LONG and SHORT confluences.
 * No re-scoring — purely derived arithmetic.
 */
export function computeBias(longConf: Confluence, shortConf: Confluence): DirectionalBias {
  const margin = longConf.total - shortConf.total;

  const lean: BiasDirection =
    margin > LEAN_DEAD_ZONE ? "LONG" :
    margin < -LEAN_DEAD_ZONE ? "SHORT" :
    "NEUTRAL";

  const strength = round3(Math.min(Math.abs(margin) / MAX_MARGIN, 1));

  const leanConf = lean === "SHORT" ? shortConf : longConf;

  const dims: ReadonlyArray<keyof Omit<Confluence, "total">> = [
    "derivatives", "etfs", "htf", "exchangeFlows",
  ];

  const topFactors: BiasFactor[] = lean === "NEUTRAL"
    ? []
    : dims
        .map((dimension) => ({ dimension, score: leanConf[dimension] }))
        .filter((f) => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

  return { lean, strength, topFactors };
}
