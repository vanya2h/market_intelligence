/**
 * Composite Target Calculator
 *
 * Computes a mean-reversion price target from HTF structure levels
 * (SMA50, SMA200, VWAP weekly, VWAP monthly) using a weighted median.
 *
 * RSI acts as a confidence multiplier — the more stretched RSI is from 50,
 * the stronger the conviction in mean-reversion levels. Near-50 RSI
 * compresses the target toward the current price.
 *
 * Produces two sets of levels tracked simultaneously:
 *   - Invalidation levels at R:R 1:2, 1:3, 1:4, 1:5 (stop losses)
 *   - Target levels at T1 (50%), T2 (100%), T3 (150%) of composite target (take profits)
 */

import type { HtfContext } from "../../htf/types.js";

export type Direction = "LONG" | "SHORT" | "FLAT";

export type LevelType = "INVALIDATION" | "TARGET";

export interface LevelResult {
  type: LevelType;
  label: string; // "1:2", "1:3", ... or "T1", "T2", "T3"
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
  sma50: 0.2,
  sma200: 0.2,
  vwapWeekly: 0.2,
  vwapMonthly: 0.15,
  poc: 0.25,
} as const;

// RSI confidence: when RSI is at 50 → floor only; at extremes → full weight
const RSI_FLOOR = 0.3;

// Fallback target distance when all levels are on wrong side
const ATR_FALLBACK_MULTIPLIER = 1.5;

// R:R ratios for invalidation levels
const RR_RATIOS = [2, 3, 4, 5] as const;

// Target multipliers: fraction of composite target distance from entry
// T1 = 50% (conservative), T2 = 100% (full target), T3 = 150% (overshoot)
const TARGET_MULTIPLIERS = [
  { label: "T1", fraction: 0.5 },
  { label: "T2", fraction: 1.0 },
  { label: "T3", fraction: 1.5 },
] as const;

// ─── Weighted median ─────────────────────────────────────────────────────────

/**
 * Computes the weighted median of a set of samples.
 *
 * Sorts samples by value, then walks through them accumulating weight
 * until the cumulative weight reaches half the total. When the median
 * falls between two samples (cumulative weight crosses the midpoint
 * within a sample), linearly interpolates between the previous and
 * current sample values proportional to how far into the current
 * sample's weight the midpoint falls.
 *
 * Unlike a weighted average, this is robust to outliers — a single
 * extreme value (e.g. SMA200 far from price) won't drag the result
 * away from the cluster of other levels.
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
      // Interpolate if we're between two samples
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

// ─── RSI confidence multiplier ───────────────────────────────────────────────

/**
 * Maps RSI distance from 50 to a confidence multiplier for mean-reversion targets.
 *
 * When RSI is at an extreme (near 0 or 100), the market is stretched and
 * mean-reversion levels are trustworthy — returns a value close to 1.0,
 * letting the composite target stand at full distance from entry.
 *
 * When RSI is near 50, there's no directional stretch — returns RSI_FLOOR
 * (0.3), compressing the target toward the entry price since a reversion
 * move is less likely to reach the full structure level.
 *
 * Output range: [RSI_FLOOR, 1.0] — never zero, so targets always have
 * some distance even in neutral RSI conditions.
 */
function rsiConfidence(rsiH4: number): number {
  // 0-1 scale: 0 when RSI = 50, 1 when RSI = 0 or 100
  const deviation = Math.abs(rsiH4 - 50) / 50;
  // Scale from RSI_FLOOR to 1.0
  return RSI_FLOOR + (1 - RSI_FLOOR) * deviation;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeCompositeTarget(htfContext: HtfContext, direction: Direction): CompositeTargetResult {
  const { price, ma, vwap, rsi, atr, volumeProfile } = htfContext;
  const entryPrice = price;

  // FLAT: target is current price, levels are breakout thresholds based on ATR.
  // Higher R:R ratio → tighter stop (same semantics as directional ideas).
  // 1:2 = 1.5×ATR (loose), 1:3 = 1.25×ATR, 1:4 = 1.0×ATR, 1:5 = 0.75×ATR (tight)
  if (direction === "FLAT") {
    const FLAT_ATR_MULTIPLIERS: Record<number, number> = { 2: 1.5, 3: 1.25, 4: 1.0, 5: 0.75 };
    const levels: LevelResult[] = RR_RATIOS.map((ratio) => ({
      type: "INVALIDATION" as const,
      label: `1:${ratio}`,
      price: (FLAT_ATR_MULTIPLIERS[ratio] ?? 1) * atr, // stored as distance — checker uses ±
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

  const rawTarget = weightedMedian(samples);

  // Check if target is on the correct side
  const targetOnCorrectSide =
    (direction === "LONG" && rawTarget > entryPrice) || (direction === "SHORT" && rawTarget < entryPrice);

  // If all structure levels are on the wrong side, use ATR fallback
  let baseTarget: number;
  if (targetOnCorrectSide) {
    baseTarget = rawTarget;
  } else {
    baseTarget =
      direction === "LONG" ? entryPrice + ATR_FALLBACK_MULTIPLIER * atr : entryPrice - ATR_FALLBACK_MULTIPLIER * atr;
  }

  // Apply RSI confidence scaling
  const confidence = rsiConfidence(rsi.h4);
  const adjustedTarget = entryPrice + (baseTarget - entryPrice) * confidence;

  const targetDistance = Math.abs(adjustedTarget - entryPrice);
  const sign = direction === "LONG" ? 1 : -1;

  // Invalidation levels: stop losses at different R:R ratios
  const invalidationLevels: LevelResult[] = RR_RATIOS.map((ratio) => ({
    type: "INVALIDATION" as const,
    label: `1:${ratio}`,
    price: entryPrice - sign * (targetDistance / ratio),
  }));

  // Target levels: take profits at fractions of the composite target distance
  const targetLevels: LevelResult[] = TARGET_MULTIPLIERS.map(({ label, fraction }) => ({
    type: "TARGET" as const,
    label,
    price: entryPrice + sign * targetDistance * fraction,
  }));

  return {
    entryPrice,
    compositeTarget: adjustedTarget,
    levels: [...invalidationLevels, ...targetLevels],
  };
}
