/**
 * Composite Target Calculator
 *
 * Computes a mean-reversion price target from HTF structure levels
 * (SMA50, SMA200, VWAP weekly, VWAP monthly) using a weighted median.
 *
 * Produces two sets of levels tracked simultaneously:
 *   - Stop levels (S1–S4): ATR-multiple stops scaled by conviction
 *   - Target levels (T1–T3): 50%/100%/150% of composite target distance
 *
 * Stops are volatility-based (ATR multiples) to survive normal noise.
 * Targets are structure-based (weighted median of key levels) since
 * that's where price actually gravitates.
 */

import type { HtfContext } from "../../htf/types.js";

export type Direction = "LONG" | "SHORT" | "FLAT";

export type LevelType = "INVALIDATION" | "TARGET";

export interface LevelResult {
  type: LevelType;
  label: string; // "S1", "S2", ... or "T1", "T2", "T3"
  price: number;
}

export interface CompositeTargetResult {
  entryPrice: number;
  compositeTarget: number;
  levels: LevelResult[];
}

interface WeightedSample {
  value: number;
  weight: number;
}

// ─── Weights for structure levels ────────────────────────────────────────────

const LEVEL_WEIGHTS = {
  sma50: 0.15,
  sma200: 0.2,
  vwapWeekly: 0.15,
  vwapMonthly: 0.15,
  poc: 0.25,
  sweep: 0.1,
} as const;

// Fallback target distance when all levels are on wrong side
const ATR_FALLBACK_MULTIPLIER = 3.0;

// ─── ATR-based stop tiers ───────────────────────────────────────────────────
// Each tier is a base ATR multiple. Conviction scaling adjusts all tiers:
//   conviction 0.0 → 0.8× (tighter — less room for low-conviction trades)
//   conviction 0.5 → 1.05×
//   conviction 1.0 → 1.3× (wider — high conviction gets more room)

const STOP_TIERS = [
  { label: "S1", base: 1.0 },   // tight — scalp invalidation
  { label: "S2", base: 1.5 },   // standard swing stop
  { label: "S3", base: 2.0 },   // wide — room for volatility
  { label: "S4", base: 2.5 },   // widest — high-conviction swing
] as const;

const CONVICTION_SCALE_MIN = 0.8;
const CONVICTION_SCALE_RANGE = 0.5; // 0.8 + 0.5 × conviction

// Target multipliers: fraction of composite target distance from entry
// T1 = 50% (conservative), T2 = 100% (full target), T3 = 150% (overshoot)
const TARGET_MULTIPLIERS = [
  { label: "T1", fraction: 0.5 },
  { label: "T2", fraction: 1.0 },
  { label: "T3", fraction: 1.5 },
] as const;

// FLAT mode: breakout distances as ATR multiples
const FLAT_ATR_MULTIPLIERS: Record<string, number> = {
  S1: 2.5,
  S2: 2.0,
  S3: 1.5,
  S4: 1.0,
};

// ─── Weighted median ─────────────────────────────────────────────────────────

/**
 * Computes the weighted median of a set of samples.
 *
 * Sorts samples by value, then walks through them accumulating weight
 * until the cumulative weight reaches half the total. Linearly interpolates
 * when the median falls between two samples.
 */
function weightedMedian(samples: WeightedSample[]): number {
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0);
  const halfWeight = totalWeight / 2;

  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const sample = sorted[i]!;
    cumulative += sample.weight;
    if (cumulative >= halfWeight) {
      if (i > 0 && cumulative - sample.weight < halfWeight) {
        const prev = sorted[i - 1]!;
        const fraction = (halfWeight - (cumulative - sample.weight)) / sample.weight;
        return prev.value + fraction * (sample.value - prev.value);
      }
      return sample.value;
    }
  }

  return sorted[sorted.length - 1]!.value;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute composite target and level set for a trade idea.
 *
 * @param htfContext - HTF context providing structure levels, ATR, price
 * @param direction - Trade direction
 * @param conviction - Confluence total for chosen direction (0..1), used to
 *                     scale stop distances — higher conviction → wider stops
 */
export function computeCompositeTarget(
  htfContext: HtfContext,
  direction: Direction,
  conviction: number = 0,
): CompositeTargetResult {
  const { price, ma, vwap, atr, volumeProfile, sweep } = htfContext;
  const entryPrice = price;
  const normalizedConviction = Math.max(conviction, 0);

  // FLAT: target is current price, levels are breakout thresholds based on ATR.
  if (direction === "FLAT") {
    const levels: LevelResult[] = Object.entries(FLAT_ATR_MULTIPLIERS).map(([label, mult]) => ({
      type: "INVALIDATION" as const,
      label,
      price: mult * atr, // stored as distance — checker uses ±
    }));

    return { entryPrice, compositeTarget: entryPrice, levels };
  }

  // Build weighted samples from structure levels
  const samples: WeightedSample[] = [
    { value: ma.sma50, weight: LEVEL_WEIGHTS.sma50 },
    { value: ma.sma200, weight: LEVEL_WEIGHTS.sma200 },
    { value: vwap.weekly, weight: LEVEL_WEIGHTS.vwapWeekly },
    { value: vwap.monthly, weight: LEVEL_WEIGHTS.vwapMonthly },
  ];

  // POC — strongest single price magnet (displacement-anchored volume profile)
  samples.push({
    value: volumeProfile.profile.poc,
    weight: LEVEL_WEIGHTS.poc,
  });

  // Sweep level — directional liquidity magnet (stale high/low with accumulated stops)
  const sweepLevel = direction === "LONG" ? sweep.nearestHigh : sweep.nearestLow;
  if (sweepLevel && sweepLevel.attraction > 0) {
    samples.push({ value: sweepLevel.price, weight: LEVEL_WEIGHTS.sweep });
  }

  const rawTarget = weightedMedian(samples);

  // Check if target is on the correct side
  const targetOnCorrectSide =
    (direction === "LONG" && rawTarget > entryPrice) || (direction === "SHORT" && rawTarget < entryPrice);

  // If all structure levels are on the wrong side, use ATR fallback
  const compositeTarget = targetOnCorrectSide
    ? rawTarget
    : direction === "LONG"
      ? entryPrice + ATR_FALLBACK_MULTIPLIER * atr
      : entryPrice - ATR_FALLBACK_MULTIPLIER * atr;

  const targetDistance = Math.abs(compositeTarget - entryPrice);
  const sign = direction === "LONG" ? 1 : -1;

  // Invalidation levels: ATR-based stops scaled by conviction
  const convictionScale = CONVICTION_SCALE_MIN + CONVICTION_SCALE_RANGE * normalizedConviction;
  const invalidationLevels: LevelResult[] = STOP_TIERS.map(({ label, base }) => ({
    type: "INVALIDATION" as const,
    label,
    price: entryPrice - sign * base * atr * convictionScale,
  }));

  // Target levels: take profits at fractions of the composite target distance
  const targetLevels: LevelResult[] = TARGET_MULTIPLIERS.map(({ label, fraction }) => ({
    type: "TARGET" as const,
    label,
    price: entryPrice + sign * targetDistance * fraction,
  }));

  return {
    entryPrice,
    compositeTarget,
    levels: [...invalidationLevels, ...targetLevels],
  };
}
