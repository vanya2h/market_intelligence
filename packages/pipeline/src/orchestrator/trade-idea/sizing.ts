/**
 * Position Sizing — Volatility-Targeted, Conviction-Scaled
 *
 * Every trade is taken, but size goes to zero when conviction is zero.
 * This naturally eliminates low-conviction noise without a hard threshold.
 *
 * Formula:
 *   dailyVol     = ATR_4h / price
 *   base         = DAILY_VOL_TARGET / dailyVol × 100   (% of account notional)
 *   multiplier   = 2.0 × conviction^1.5                 (power curve γ=1.5)
 *   positionSizePct = clamp(base × multiplier, 0, MAX)
 *
 * Conviction range 0–1 (normalized confluence total):
 *   0    → multiplier 0    — no position (zero conviction = skip)
 *   0.2  → multiplier 0.18 — tiny pilot
 *   0.5  → multiplier 0.71 — moderate position
 *   0.75 → multiplier 1.30 — full-size position
 *   1.0  → multiplier 2.0  — maximum conviction
 *
 * Compression bonus (+0.25x): applied when ATR is compressed after a
 * recent displacement (coiled spring). Setup quality justifies larger size.
 *
 * BTC vs ETH sizing example at equal account:
 *   BTC ATR/price ≈ 1.65% → base ≈ 121% → size at conviction 0.75: ~157% (capped 150%)
 *   ETH ATR/price ≈ 4.40% → base ≈ 45%  → size at conviction 0.75: ~59%
 */

import type { HtfContext } from "../../htf/types.js";

/** Target daily vol contribution per position (as fraction of account notional) */
const DAILY_VOL_TARGET = 0.02;

/** Position size cap (% of account notional) */
const MAX_POSITION_PCT = 150;

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
 * @param conviction - Confluence total for the chosen direction (0..1, the new
 *                     normalized weighted average). Negative values are clamped
 *                     to 0 (the caller passes the chosen-direction total, but
 *                     defensive code path).
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
  //    Zero conviction → zero size; aggressively rewards high conviction.
  const normalizedConviction = Math.max(conviction, 0);
  const base = 2.0 * Math.pow(normalizedConviction, 1.5);

  // 4. Compression bonus: coiled spring after displacement = higher setup quality
  const compressionBonus =
    htfContext.volatility.compressionAfterMove && htfContext.volatility.atrPercentile <= 10 ? 0.25 : 0;

  const convictionMultiplier = Math.round((base + compressionBonus) * 100) / 100;

  // 5. Final size (clamped, 1 decimal)
  const positionSizePct =
    Math.round(Math.min(Math.max(baseAllocationPct * convictionMultiplier, 0), MAX_POSITION_PCT) * 10) / 10;

  return {
    positionSizePct,
    convictionMultiplier,
    dailyVolPct: Math.round(dailyVolPct * 10000) / 10000,
  };
}
