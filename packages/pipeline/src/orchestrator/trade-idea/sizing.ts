/**
 * Position Sizing — Volatility-Targeted, Conviction-Scaled
 *
 * Every trade is taken. Size scales non-linearly with conviction
 * and inversely with realized volatility (ATR proxy).
 *
 * Formula:
 *   dailyVol     = ATR_4h / price
 *   base         = DAILY_VOL_TARGET / dailyVol × 100   (% of account notional)
 *   multiplier   = 0.25 + 1.75 × (conviction/400)^1.5  (power curve γ=1.5)
 *   positionSizePct = clamp(base × multiplier, MIN, MAX)
 *
 * Conviction range 0–400:
 *   0   → multiplier 0.25 — minimal pilot position
 *   200 → multiplier ≈0.87 — moderate position
 *   300 → multiplier ≈1.39 — full-size position
 *   400 → multiplier 2.0  — maximum conviction
 *
 * Compression bonus (+0.25x): applied when ATR is compressed after a
 * recent displacement (coiled spring). Setup quality justifies larger size
 * despite potentially ambiguous weaker dimensions.
 *
 * BTC vs ETH sizing example at equal account:
 *   BTC ATR/price ≈ 1.65% → base ≈ 121% → size at conviction 300: ~168% (capped 150%)
 *   ETH ATR/price ≈ 4.40% → base ≈ 45%  → size at conviction 300: ~63%
 */

import type { HtfContext } from "../../htf/types.js";

/** Target daily vol contribution per position (as fraction of account notional) */
const DAILY_VOL_TARGET = 0.02;

/** Position size bounds (% of account notional) */
const MAX_POSITION_PCT = 150;
const MIN_POSITION_PCT = 5;

export interface PositionSize {
  /** Recommended position as % of account notional (5–150) */
  positionSizePct: number;
  /** Non-linear conviction × compression factor applied to base (0.25–2.25) */
  convictionMultiplier: number;
  /** Daily vol estimate: ATR / price */
  dailyVolPct: number;
}

/**
 * Compute position size from conviction score and current HTF volatility.
 *
 * @param conviction - Raw confluence total for the chosen direction (0–400)
 * @param htfContext - HTF context providing ATR, price, and volatility state
 */
export function computePositionSize(conviction: number, htfContext: HtfContext): PositionSize {
  // 1. Daily realized vol proxy: ATR(4h) / price
  //    Slightly understates true daily vol (≈ATR×√6/price) but bakes in
  //    a conservative buffer for crypto's fat tails.
  const dailyVolPct = htfContext.atr / htfContext.price;

  // 2. Inverse vol base — equal risk contribution across assets
  const baseAllocationPct = (DAILY_VOL_TARGET / dailyVolPct) * 100;

  // 3. Non-linear conviction multiplier (power curve γ=1.5)
  //    Aggressively rewards high conviction; keeps low conviction small.
  const normalizedConviction = Math.max(conviction, 0) / 400;
  const base = 0.25 + 1.75 * Math.pow(normalizedConviction, 1.5);

  // 4. Compression bonus: coiled spring after displacement = higher setup quality
  const compressionBonus =
    htfContext.volatility.compressionAfterMove && htfContext.volatility.atrPercentile <= 10
      ? 0.25
      : 0;

  const convictionMultiplier = Math.round((base + compressionBonus) * 100) / 100;

  // 5. Final size (clamped, 1 decimal)
  const positionSizePct =
    Math.round(
      Math.min(
        Math.max(baseAllocationPct * convictionMultiplier, MIN_POSITION_PCT),
        MAX_POSITION_PCT,
      ) * 10,
    ) / 10;

  return {
    positionSizePct,
    convictionMultiplier,
    dailyVolPct: Math.round(dailyVolPct * 10000) / 10000,
  };
}
