/**
 * HTF Technical Structure — Deterministic Analyzer (Dimension 07)
 *
 * Computes from raw candles:
 *   SMA 50, SMA 200 (daily)
 *   RSI-14 (daily + weekly, Wilder smoothing)
 *   Market structure via weekly pivot highs/lows (HH/HL/LH/LL)
 *   MA cross type (golden / death)
 *
 * Transition rules:
 *   price > 200 DMA + weeklyRSI > 70              → BULL_EXTENDED
 *   price > 200 DMA + HH/HL structure             → MACRO_BULLISH
 *   price < 200 DMA + weeklyRSI < 30              → BEAR_EXTENDED
 *   price < 200 DMA + LH/LL structure             → MACRO_BEARISH
 *   50 DMA < price < 200 DMA                      → RECLAIMING
 *   else                                           → RANGING
 */

import {
  Candle,
  CvdContext,
  CvdDivergence,
  CvdDivergenceMechanism,
  CvdExtreme,
  CvdRegime,
  CvdSeries,
  CvdWindow,
  DivergenceConfluence,
  HtfBias,
  HtfContext,
  HtfEvent,
  HtfRegime,
  HtfSnapshot,
  HtfState,
  MaContext,
  MaCrossType,
  MarketStructure,
  MfiContext,
  MfiDivergence,
  RsiContext,
  RsiDivergence,
  SignalStaleness,
  SpotFuturesCvdDivergence,
  SthContext,
  VolatilityContext,
  VolumeProfileContext,
  VolumeProfilePosition,
  VolumeProfileResult,
  VwapContext,
  SweepContext,
  SweepLevel,
  SweepLevelType,
  SweepPeriod,
} from "./types.js";

// ─── Technical indicators ─────────────────────────────────────────────────────

function sma(closes: number[], period: number): number {
  const window = closes.slice(-period);
  return window.reduce((s, v) => s + v, 0) / window.length;
}

/** RSI-14 using Wilder's smoothing on the given close array */
function rsi14(closes: number[]): number {
  if (closes.length < 15) return 50; // not enough data

  const changes = closes.slice(1).map((c, i) => c - closes[i]!);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  // Seed with simple average of first 14 periods
  let avgGain = gains.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  let avgLoss = losses.slice(0, 14).reduce((s, v) => s + v, 0) / 14;

  // Wilder smoothing from period 15 onward
  for (let i = 14; i < gains.length; i++) {
    avgGain = (avgGain * 13 + gains[i]!) / 14;
    avgLoss = (avgLoss * 13 + losses[i]!) / 14;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/**
 * Rolling RSI-14 curve — one value per candle position, built in a single pass
 * with Wilder smoothing. Values before index 14 are filled with 50 (neutral).
 *
 * Used for divergence detection: compare price swing highs/lows against
 * RSI swing highs/lows on the same curve.
 */
export function rsi14Curve(closes: number[]): number[] {
  const curve: number[] = new Array(closes.length).fill(50);
  if (closes.length < 15) return curve;

  const changes = closes.slice(1).map((c, i) => c - closes[i]!);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  let avgLoss = losses.slice(0, 14).reduce((s, v) => s + v, 0) / 14;

  const setAt = (closeIdx: number, rsi: number) => {
    curve[closeIdx] = rsi;
  };

  // Seed value at index 14 (corresponds to 14 changes consumed)
  setAt(14, avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = 14; i < gains.length; i++) {
    avgGain = (avgGain * 13 + gains[i]!) / 14;
    avgLoss = (avgLoss * 13 + losses[i]!) / 14;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    // change index i uses closes[i] and closes[i+1]; RSI is "after i+1"
    setAt(i + 1, rsi);
  }

  return curve;
}

// ─── MFI (Money Flow Index — volume-weighted momentum) ───────────────────────

/**
 * MFI-14 using the standard rolling 14-period sum (matches TradingView reference).
 *
 * Formula:
 *   Typical Price (TP) = (H + L + C) / 3
 *   Raw Money Flow     = TP × Volume
 *   Positive MF        = sum of Raw MF where TP[i] > TP[i-1] (rolling 14)
 *   Negative MF        = sum of Raw MF where TP[i] < TP[i-1] (rolling 14)
 *   MFI                = 100 - 100 / (1 + positiveMF / negativeMF)
 */
function mfi14(candles: Candle[]): number {
  if (candles.length < 15) return 50;

  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const n = candles.length;

  let posSum = 0;
  let negSum = 0;
  // Rolling 14-period sum: use last 14 period-to-period classifications.
  // Iterate i from n-14 to n-1, comparing tp[i] to tp[i-1].
  for (let i = n - 14; i < n; i++) {
    const rmf = tp[i]! * candles[i]!.volume;
    if (tp[i]! > tp[i - 1]!) posSum += rmf;
    else if (tp[i]! < tp[i - 1]!) negSum += rmf;
  }

  if (negSum === 0) return 100;
  return parseFloat((100 - 100 / (1 + posSum / negSum)).toFixed(2));
}

/**
 * Rolling MFI-14 curve — one value per candle using the standard rolling
 * 14-period sum (matches TradingView reference). Uses O(n) sliding window:
 * add newest period classification, subtract the one that rolled off.
 * Values before index 14 are filled with 50 (neutral).
 */
export function mfi14Curve(candles: Candle[]): number[] {
  const curve: number[] = new Array(candles.length).fill(50);
  if (candles.length < 15) return curve;

  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);

  const posMf: number[] = [0]; // align with candle indices: posMf[i] uses tp[i] vs tp[i-1]
  const negMf: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const rmf = tp[i]! * candles[i]!.volume;
    posMf.push(tp[i]! > tp[i - 1]! ? rmf : 0);
    negMf.push(tp[i]! < tp[i - 1]! ? rmf : 0);
  }

  // Sliding window: sum of last 14 classifications ending at index i
  let posSum = 0;
  let negSum = 0;
  for (let i = 1; i <= 14; i++) {
    posSum += posMf[i]!;
    negSum += negMf[i]!;
  }
  curve[14] = negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum);

  for (let i = 15; i < candles.length; i++) {
    posSum += posMf[i]! - posMf[i - 14]!;
    negSum += negMf[i]! - negMf[i - 14]!;
    curve[i] = negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum);
  }

  return curve;
}

// ─── CVD regime detection (dual-window + divergence) ─────────────────────────

const CVD_SHORT_LOOKBACK = 20;  // ~3.3 days — catches regime turns early
const CVD_LONG_LOOKBACK  = 75;  // ~12.5 days — covers a full swing hold
const SLOPE_THRESHOLD = 0.02;
const R2_THRESHOLD    = 0.3;

/**
 * Linear regression on a numeric series.
 * Returns { slope, intercept, r2 }.
 */
function linreg(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  const sumX  = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  let sumY  = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumY  += values[i]!;
    sumXY += i * values[i]!;
  }
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (values[i]! - meanY) ** 2;
    ssRes += (values[i]! - (intercept + slope * i)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2: parseFloat(r2.toFixed(4)) };
}

/** Build the cumulative CVD curve from candle deltas. */
export function buildCvdCurve(candles: Candle[]): number[] {
  const curve: number[] = [];
  let running = 0;
  for (const c of candles) {
    running += 2 * c.takerBuyVolume - c.volume;
    curve.push(running);
  }
  return curve;
}

/**
 * Classify a CVD window into a regime using swing structure.
 *
 * Finds swing highs/lows on the CVD curve, then checks:
 *   HH + HL → RISING     (buyers in control)
 *   LH + LL → DECLINING  (sellers in control)
 *   mixed   → FLAT
 *
 * Magnitude (slope field): how far the last swing low is from the last swing
 * high, normalized by average volume — captures the amplitude of the move.
 *
 * Confidence (r2 field): 1.0 when both HH/HL or LH/LL agree, 0.5 when only
 * one condition holds, 0 when neither.
 */
function classifyWindow(candles: Candle[], cvdCurve: number[]): CvdWindow {
  const n = candles.length;
  if (n < 10) return { regime: "FLAT", slope: 0, r2: 0 };

  // Use smaller lookback for short windows, larger for long
  const lb = n <= 25 ? 3 : 5;

  const highs = swingHighs(cvdCurve, lb);
  const lows  = swingLows(cvdCurve, lb);

  if (highs.length < 2 || lows.length < 2) {
    // Not enough pivots — fall back to simple start-vs-end direction
    const delta = cvdCurve.at(-1)! - cvdCurve[0]!;
    const totalVolume = candles.reduce((s, c) => s + c.volume, 0);
    const mag = totalVolume === 0 ? 0 : Math.abs(delta) / totalVolume;
    const regime: CvdRegime = mag > 0.01 ? (delta > 0 ? "RISING" : "DECLINING") : "FLAT";
    return {
      regime,
      slope: parseFloat((regime === "DECLINING" ? -mag : mag).toFixed(6)),
      r2: regime !== "FLAT" ? 0.25 : 0, // low confidence — no structural confirmation
    };
  }

  const hh = highs.at(-1)!.value > highs.at(-2)!.value;
  const lh = highs.at(-1)!.value < highs.at(-2)!.value;
  const hl = lows.at(-1)!.value > lows.at(-2)!.value;
  const ll = lows.at(-1)!.value < lows.at(-2)!.value;

  // Magnitude: distance between last swing high and last swing low,
  // normalized by total volume over the window
  const lastHigh = highs.at(-1)!.value;
  const lastLow  = lows.at(-1)!.value;
  const totalVolume = candles.reduce((s, c) => s + c.volume, 0);
  const magnitude = totalVolume === 0 ? 0 : Math.abs(lastHigh - lastLow) / totalVolume;

  let regime: CvdRegime = "FLAT";
  let confidence = 0;

  if (hh && hl) {
    regime = "RISING";
    confidence = 1.0;
  } else if (lh && ll) {
    regime = "DECLINING";
    confidence = 1.0;
  } else if (hh || hl) {
    regime = "RISING";
    confidence = 0.5;
  } else if (lh || ll) {
    regime = "DECLINING";
    confidence = 0.5;
  }

  return {
    regime,
    slope: parseFloat((regime === "DECLINING" ? -magnitude : magnitude).toFixed(6)),
    r2: confidence,
  };
}

/**
 * Find swing highs in a numeric series.
 * A swing high is a value strictly greater than `lookback` neighbors on each side.
 */
export function swingHighs(values: number[], lookback = 3): { index: number; value: number }[] {
  const results: { index: number; value: number }[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const v = values[i]!;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (values[i - j]! >= v || values[i + j]! >= v) { isPivot = false; break; }
    }
    if (isPivot) results.push({ index: i, value: v });
  }
  return results;
}

/**
 * Find swing lows in a numeric series.
 * A swing low is a value strictly less than `lookback` neighbors on each side.
 */
export function swingLows(values: number[], lookback = 3): { index: number; value: number }[] {
  const results: { index: number; value: number }[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const v = values[i]!;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (values[i - j]! <= v || values[i + j]! <= v) { isPivot = false; break; }
    }
    if (isPivot) results.push({ index: i, value: v });
  }
  return results;
}

/**
 * Detect price–CVD divergence by comparing swing highs and lows.
 *
 * Identifies both the direction (BULLISH/BEARISH) and the mechanism:
 *
 *   ABSORPTION: CVD makes new extreme, price does not.
 *     → opposing side is absorbing aggression (stronger signal)
 *     · Bearish absorption: CVD higher high, price fails higher high
 *     · Bullish absorption: CVD lower low, price fails lower low
 *
 *   EXHAUSTION: Price makes new extreme, CVD does not.
 *     → aggression is disappearing, move driven by thin liquidity
 *     · Bearish exhaustion: price higher high, CVD lower high
 *     · Bullish exhaustion: price lower low, CVD higher low
 *
 * Absorption takes priority over exhaustion when both could apply.
 */
function detectDivergence(
  candles: Candle[],
  cvdCurve: number[]
): { divergence: CvdDivergence; mechanism: CvdDivergenceMechanism } {
  const NONE = { divergence: "NONE" as CvdDivergence, mechanism: "NONE" as CvdDivergenceMechanism };
  const MIN_PIVOTS = 2;
  const LOOKBACK = 14;
  const MIN_PIVOT_DISTANCE = 5;     // min candles between compared pivots
  const MIN_PRICE_SWING_PCT = 0.5;  // ignore HH/LL if price diff < 0.5%

  if (candles.length < LOOKBACK * 2 + MIN_PIVOTS + 1) return NONE;

  const priceHighValues = candles.map((c) => c.high);
  const priceLowValues  = candles.map((c) => c.low);

  const pH = swingHighs(priceHighValues, LOOKBACK);
  const pL = swingLows(priceLowValues, LOOKBACK);
  const cH = swingHighs(cvdCurve, LOOKBACK);
  const cL = swingLows(cvdCurve, LOOKBACK);

  if (pH.length < MIN_PIVOTS || pL.length < MIN_PIVOTS ||
      cH.length < MIN_PIVOTS || cL.length < MIN_PIVOTS) return NONE;

  // Pick the last two pivots that are sufficiently spaced apart
  const lastTwo = <T extends { index: number; value: number }>(arr: T[]): [T, T] | null => {
    for (let i = arr.length - 1; i >= 1; i--) {
      if (arr[i]!.index - arr[i - 1]!.index >= MIN_PIVOT_DISTANCE) {
        return [arr[i - 1]!, arr[i]!];
      }
    }
    return null;
  };

  const pHPair = lastTwo(pH);
  const pLPair = lastTwo(pL);
  const cHPair = lastTwo(cH);
  const cLPair = lastTwo(cL);

  if (!pHPair || !pLPair || !cHPair || !cLPair) return NONE;

  const priceMid = (pHPair[1].value + pLPair[1].value) / 2;
  const minSwing = priceMid * (MIN_PRICE_SWING_PCT / 100);

  const priceHH = pHPair[1].value > pHPair[0].value &&
    Math.abs(pHPair[1].value - pHPair[0].value) >= minSwing;
  const cvdHH   = cHPair[1].value > cHPair[0].value;
  const priceLL = pLPair[1].value < pLPair[0].value &&
    Math.abs(pLPair[1].value - pLPair[0].value) >= minSwing;
  const cvdLL   = cLPair[1].value < cLPair[0].value;

  // Bearish: absorption (CVD HH, price fails) — stronger than exhaustion
  if (cvdHH && !priceHH) return { divergence: "BEARISH", mechanism: "ABSORPTION" };
  // Bullish: absorption (CVD LL, price holds) — stronger than exhaustion
  if (cvdLL && !priceLL) return { divergence: "BULLISH", mechanism: "ABSORPTION" };
  // Bearish: exhaustion (price HH, CVD fails)
  if (priceHH && !cvdHH) return { divergence: "BEARISH", mechanism: "EXHAUSTION" };
  // Bullish: exhaustion (price LL, CVD holds)
  if (priceLL && !cvdLL) return { divergence: "BULLISH", mechanism: "EXHAUSTION" };

  return NONE;
}

// ─── Generic price / indicator divergence (MFI, RSI, and magnitude for CVD) ─

const DIV_LOOKBACK = 14;
const DIV_MIN_PIVOT_DISTANCE = 5;
const DIV_MIN_PRICE_SWING_PCT = 0.5;
/** Gap size (price % + normalized indicator) that maps to magnitude 1.0 before the power curve. */
const DIV_MAGNITUDE_SATURATION = 0.08;

/**
 * Find the last two price swing-high pivots spaced ≥ DIV_MIN_PIVOT_DISTANCE apart.
 * Returns null if not enough pivots.
 */
function lastTwoPivots<T extends { index: number; value: number }>(arr: T[]): [T, T] | null {
  for (let i = arr.length - 1; i >= 1; i--) {
    if (arr[i]!.index - arr[i - 1]!.index >= DIV_MIN_PIVOT_DISTANCE) {
      return [arr[i - 1]!, arr[i]!];
    }
  }
  return null;
}

/**
 * Normalize an indicator change between two points into a 0-1 scale.
 *
 * RSI / MFI are bounded 0-100, so we divide by 100 for a natural scale.
 * CVD is unbounded, so we divide by the curve's value range over the window.
 */
function normalizeIndicatorMove(
  indicatorCurve: number[],
  idx1: number,
  idx2: number,
  kind: "bounded" | "unbounded"
): number {
  const v1 = indicatorCurve[idx1]!;
  const v2 = indicatorCurve[idx2]!;
  if (kind === "bounded") {
    return (v2 - v1) / 100;
  }
  const windowSlice = indicatorCurve.slice(Math.max(0, idx1 - 5), idx2 + 1);
  const range = Math.max(...windowSlice) - Math.min(...windowSlice);
  if (range === 0) return 0;
  return (v2 - v1) / range;
}

/**
 * Generic price/indicator divergence detector — used for RSI and MFI.
 *
 * Uses price pivots as anchors (found via swingHighs/swingLows on price), then
 * samples the indicator curve at those same indexes. This gives us a direct
 * "at the time price did X, indicator did Y" comparison on matched intervals.
 *
 * Magnitude (0-1) measures how steep the disagreement is:
 *   gap = |pricePctMove| + |indicatorNormMove|  (they have opposite signs, so absolutes sum)
 *   magnitude = (gap / saturation) ^ 0.7        (power curve amplifies small-to-moderate gaps)
 *
 * Returns { direction: "NONE", magnitude: 0 } when no divergence detected.
 */
export function detectIndicatorDivergence(
  candles: Candle[],
  indicatorCurve: number[],
  kind: "bounded" | "unbounded"
): { direction: "BULLISH" | "BEARISH" | "NONE"; magnitude: number } {
  const NONE = { direction: "NONE" as const, magnitude: 0 };
  if (candles.length < DIV_LOOKBACK * 2 + 3) return NONE;
  if (indicatorCurve.length !== candles.length) return NONE;

  const priceHighs = swingHighs(candles.map((c) => c.high), DIV_LOOKBACK);
  const priceLows = swingLows(candles.map((c) => c.low), DIV_LOOKBACK);

  const pHPair = lastTwoPivots(priceHighs);
  const pLPair = lastTwoPivots(priceLows);
  if (!pHPair && !pLPair) return NONE;

  const magnitudeFromGap = (pricePct: number, indicatorNorm: number): number => {
    const gap = Math.abs(pricePct) + Math.abs(indicatorNorm);
    const raw = Math.min(gap / DIV_MAGNITUDE_SATURATION, 1);
    return parseFloat(Math.pow(raw, 0.7).toFixed(3));
  };

  // Bearish divergence: price HH, indicator lower at second pivot
  if (pHPair) {
    const [p1, p2] = pHPair;
    const priceMid = p2.value;
    const minSwing = priceMid * (DIV_MIN_PRICE_SWING_PCT / 100);
    const priceHH = p2.value > p1.value && Math.abs(p2.value - p1.value) >= minSwing;
    if (priceHH) {
      const indMove = normalizeIndicatorMove(indicatorCurve, p1.index, p2.index, kind);
      if (indMove < 0) {
        const pricePct = (p2.value - p1.value) / p1.value;
        return { direction: "BEARISH", magnitude: magnitudeFromGap(pricePct, indMove) };
      }
    }
  }

  // Bullish divergence: price LL, indicator higher at second pivot
  if (pLPair) {
    const [p1, p2] = pLPair;
    const priceMid = p2.value;
    const minSwing = priceMid * (DIV_MIN_PRICE_SWING_PCT / 100);
    const priceLL = p2.value < p1.value && Math.abs(p2.value - p1.value) >= minSwing;
    if (priceLL) {
      const indMove = normalizeIndicatorMove(indicatorCurve, p1.index, p2.index, kind);
      if (indMove > 0) {
        const pricePct = (p2.value - p1.value) / p1.value;
        return { direction: "BULLISH", magnitude: magnitudeFromGap(pricePct, indMove) };
      }
    }
  }

  return NONE;
}

/**
 * MFI divergence detection on 4h candles.
 * MFI divergences are always exhaustion (oscillator, not cumulative).
 */
export function detectMfiDivergence(candles: Candle[]): {
  direction: MfiDivergence;
  magnitude: number;
} {
  const curve = mfi14Curve(candles);
  const { direction, magnitude } = detectIndicatorDivergence(candles, curve, "bounded");
  return { direction, magnitude };
}

/**
 * RSI divergence detection on 4h candles.
 * Uses RSI-14 curve built from closes, aligned to candle indices.
 */
export function detectRsiDivergence(candles: Candle[]): {
  direction: RsiDivergence;
  magnitude: number;
} {
  const curve = rsi14Curve(candles.map((c) => c.close));
  const { direction, magnitude } = detectIndicatorDivergence(candles, curve, "bounded");
  return { direction, magnitude };
}

/**
 * Compute magnitude for a CVD divergence that was already detected (with mechanism)
 * by the existing pivot-based detector. We sample the CVD curve at the price pivots
 * for consistent magnitude scaling across indicators.
 *
 * Returns 0 if direction is "NONE" or if pivots insufficient.
 */
export function cvdDivergenceMagnitude(
  candles: Candle[],
  cvdCurve: number[],
  direction: CvdDivergence
): number {
  if (direction === "NONE") return 0;
  const result = detectIndicatorDivergence(candles, cvdCurve, "unbounded");
  // Trust the original detector's direction; use the magnitude from the generic
  // detector when it agrees. When disagreeing, fall back to a conservative 0.3.
  return result.direction === direction ? result.magnitude : 0.3;
}

// ─── Divergence confluence (magnitude-weighted) ──────────────────────────────

/**
 * Per-indicator weights in the confluence score. MFI is weighted highest because
 * volume-confirmed exhaustion is the strongest single divergence signal.
 */
const DIV_W: Record<"mfi" | "rsi" | "cvd_futures" | "cvd_spot", number> = {
  mfi: 1.30,         // volume-weighted momentum — strongest for mean reversion
  cvd_futures: 1.10, // authoritative leveraged intent
  rsi: 0.80,         // price-only momentum, weaker as standalone
  cvd_spot: 0.70,    // confirms demand but leads less than futures
};

/** Saturation steepness — tuned so one strong MFI divergence reaches ~0.76. */
const DIV_SATURATION_K = 1.2;

/**
 * Combine per-indicator divergences into a magnitude-weighted confluence score.
 *
 * Only divergences agreeing on direction contribute. The weighted sum of their
 * magnitudes is passed through a saturation curve `1 - exp(-k × sum)` which:
 *   - rewards strong individual signals (not just counts)
 *   - caps at 1.0 to prevent overflow
 *   - produces ~0.38 for one moderate divergence, ~0.76 for one strong MFI div,
 *     ~0.89 for MFI+CVD both strong
 */
export function computeDivergenceConfluence(
  mfi: { direction: MfiDivergence; magnitude: number },
  rsi: { direction: RsiDivergence; magnitude: number },
  cvdFutures: { direction: CvdDivergence; magnitude: number },
  cvdSpot: { direction: CvdDivergence; magnitude: number }
): DivergenceConfluence {
  type Kind = "mfi" | "rsi" | "cvd_futures" | "cvd_spot";
  const all: Array<{ indicator: Kind; direction: "BULLISH" | "BEARISH" | "NONE"; magnitude: number }> = [
    { indicator: "mfi", direction: mfi.direction, magnitude: mfi.magnitude },
    { indicator: "rsi", direction: rsi.direction, magnitude: rsi.magnitude },
    { indicator: "cvd_futures", direction: cvdFutures.direction, magnitude: cvdFutures.magnitude },
    { indicator: "cvd_spot", direction: cvdSpot.direction, magnitude: cvdSpot.magnitude },
  ];

  // Tally weighted magnitude per direction, pick whichever is larger
  let bullSum = 0;
  let bearSum = 0;
  const bullSources: Array<{ indicator: Kind; magnitude: number }> = [];
  const bearSources: Array<{ indicator: Kind; magnitude: number }> = [];

  for (const d of all) {
    if (d.direction === "NONE" || d.magnitude <= 0) continue;
    const weighted = d.magnitude * DIV_W[d.indicator];
    if (d.direction === "BULLISH") {
      bullSum += weighted;
      bullSources.push({ indicator: d.indicator, magnitude: d.magnitude });
    } else {
      bearSum += weighted;
      bearSources.push({ indicator: d.indicator, magnitude: d.magnitude });
    }
  }

  if (bullSum === 0 && bearSum === 0) {
    return { direction: "NONE", sources: [], strength: 0 };
  }

  const bullish = bullSum >= bearSum;
  const weightedSum = bullish ? bullSum : bearSum;
  const sources = bullish ? bullSources : bearSources;

  // Saturation curve: 1 - e^(-k×sum) — bounded 0-1, concave
  const strength = parseFloat((1 - Math.exp(-DIV_SATURATION_K * weightedSum)).toFixed(3));

  return {
    direction: bullish ? "BULLISH" : "BEARISH",
    sources,
    strength,
  };
}

/**
 * Compare spot and futures CVD short-window regimes to detect
 * whether a price move has real demand behind it.
 *
 *   CONFIRMED_BUYING:  both rising  → genuine buyers
 *   CONFIRMED_SELLING: both falling → genuine sellers
 *   SUSPECT_BOUNCE:    futures rising + spot flat/falling
 *                      → short covering, no real spot demand
 *   SPOT_LEADS:        spot rising  + futures flat/falling
 *                      → organic accumulation without leverage
 */
function computeSpotFuturesDivergence(
  spotShort: CvdWindow,
  futuresShort: CvdWindow
): SpotFuturesCvdDivergence {
  const f = futuresShort.regime;
  const s = spotShort.regime;

  if (f === "RISING"   && s === "RISING")   return "CONFIRMED_BUYING";
  if (f === "DECLINING" && s === "DECLINING") return "CONFIRMED_SELLING";
  if (f === "RISING"   && s !== "RISING")   return "SUSPECT_BOUNCE";
  if (s === "RISING"   && f !== "RISING")   return "SPOT_LEADS";

  return "NONE";
}

/**
 * Detect overbought/oversold CVD extremes within the swing structure.
 *
 * When CVD is in a RISING structure (HH/HL), an unusually large upward spike
 * signals overbought — aggressive buyers exhausting themselves at the top,
 * likely forming a new swing high. Mirror logic for DECLINING + downward spike.
 *
 * Uses the percentile of recent CVD change (last 5 candles' cumulative delta)
 * within the full window's distribution of rolling 5-candle changes.
 * Also measures how far the current value extends beyond the last swing extreme.
 */
const CVD_EXTREME_ROLL = 5; // rolling window for change measurement
const CVD_EXTREME_PCTILE = 90; // percentile threshold for extreme

function detectCvdExtreme(
  cvdCurve: number[],
  longWindow: CvdWindow,
): CvdExtreme {
  const NONE: CvdExtreme = { state: "NONE", changePctile: 50, extensionPct: 0 };
  if (cvdCurve.length < CVD_EXTREME_ROLL + 10) return NONE;

  // Build distribution of rolling N-candle CVD changes across the window
  const changes: number[] = [];
  for (let i = CVD_EXTREME_ROLL; i < cvdCurve.length; i++) {
    changes.push(cvdCurve[i]! - cvdCurve[i - CVD_EXTREME_ROLL]!);
  }
  const recentChange = changes.at(-1)!;

  // Percentile of the recent change within the distribution
  const sorted = [...changes].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) { if (v < recentChange) rank++; else break; }
  const changePctile = Math.round((rank / sorted.length) * 100);

  // Extension: how far current CVD is beyond the last swing high or low
  const lb = cvdCurve.length <= 25 ? 3 : 5;
  const highs = swingHighs(cvdCurve, lb);
  const lows  = swingLows(cvdCurve, lb);

  const curValue = cvdCurve.at(-1)!;
  const cvdRange = Math.max(...cvdCurve) - Math.min(...cvdCurve);
  if (cvdRange === 0) return NONE;

  let extensionPct = 0;
  let state: CvdExtreme["state"] = "NONE";

  if (longWindow.regime === "RISING" && highs.length >= 1) {
    const lastSwingHigh = highs.at(-1)!.value;
    if (curValue > lastSwingHigh) {
      extensionPct = ((curValue - lastSwingHigh) / cvdRange) * 100;
    }
    if (changePctile >= CVD_EXTREME_PCTILE) {
      state = "OVERBOUGHT";
    }
  } else if (longWindow.regime === "DECLINING" && lows.length >= 1) {
    const lastSwingLow = lows.at(-1)!.value;
    if (curValue < lastSwingLow) {
      extensionPct = ((lastSwingLow - curValue) / cvdRange) * 100;
    }
    if (changePctile <= (100 - CVD_EXTREME_PCTILE)) {
      state = "OVERSOLD";
    }
  }

  return {
    state,
    changePctile,
    extensionPct: parseFloat(extensionPct.toFixed(1)),
  };
}

/**
 * Full CVD analysis: dual-window regime + pivot-based divergence + extremes.
 *
 * Short window (20 candles ≈ 3.3d): detects early regime shifts for entries.
 * Long window  (75 candles ≈ 12.5d): confirms the trend across a swing hold.
 * Divergence checked on the long window using swing high/low comparison.
 * Extremes checked on the long window — spikes within the swing structure.
 */
function cvdAnalysis(candles: Candle[]): CvdSeries {
  const longSlice  = candles.slice(-CVD_LONG_LOOKBACK);
  const shortSlice = longSlice.slice(-CVD_SHORT_LOOKBACK);

  const longCurve  = buildCvdCurve(longSlice);
  const shortCurve = buildCvdCurve(shortSlice);

  const longWindow  = classifyWindow(longSlice, longCurve);
  const shortWindow = classifyWindow(shortSlice, shortCurve);

  const value = longCurve.length > 0 ? parseFloat(longCurve.at(-1)!.toFixed(2)) : 0;
  const { divergence, mechanism: divergenceMechanism } = detectDivergence(longSlice, longCurve);
  const extreme = detectCvdExtreme(longCurve, longWindow);

  return { value, short: shortWindow, long: longWindow, divergence, divergenceMechanism, extreme };
}

/**
 * VWAP anchored to the start of a calendar period.
 * Scans candles whose open time falls within the current week/month.
 */
function anchoredVwap(candles: Candle[], periodStart: number): number {
  let sumPV = 0;
  let sumV = 0;
  for (const c of candles) {
    if (c.time < periodStart) continue;
    const typical = (c.high + c.low + c.close) / 3;
    sumPV += typical * c.volume;
    sumV += c.volume;
  }
  if (sumV === 0) return 0;
  return parseFloat((sumPV / sumV).toFixed(2));
}

// ─── STH Realized Price proxy ────────────────────────────────────────────────

const STH_WINDOW = 155; // days — standard short-term holder cohort window

/**
 * Compute the Short Term Holder realized price proxy using a 155-day VWAP.
 *
 * True STH-RP requires on-chain UTXO data (Glassnode). This approximation uses
 * volume-weighted average price over the last 155 daily candles, which closely
 * tracks the on-chain figure because exchange volume serves as a proxy for
 * coin movement activity.
 *
 * Interpretation:
 *   - Price below STH proxy: average recent buyer is underwater → behavioral
 *     anchor for mean reversion once reclaimed (break-even selling zone)
 *   - Price above STH proxy: average recent buyer in profit → latent sell
 *     pressure fades as a support level on pullbacks
 */
function computeSthProxy(dailyCandles: Candle[], currentPrice: number): SthContext {
  const window = dailyCandles.slice(-STH_WINDOW);
  const sumVol = window.reduce((s, c) => s + c.volume, 0);
  const sthPrice = sumVol === 0
    ? currentPrice
    : window.reduce((s, c) => s + c.close * c.volume, 0) / sumVol;

  return {
    price: parseFloat(sthPrice.toFixed(2)),
    priceVsSthPct: parseFloat(((currentPrice / sthPrice - 1) * 100).toFixed(2)),
  };
}

// ─── ATR ──────────────────────────────────────────────────────────────────────

/** ATR-14 using Wilder smoothing on any timeframe candles */
function atr14(candles: Candle[]): number {
  if (candles.length < 15) return 0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }

  // Seed with simple average of first 14 TRs
  let atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;

  // Wilder smoothing from period 15 onward
  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]!) / 14;
  }

  return parseFloat(atr.toFixed(2));
}

// ─── Volatility compression ──────────────────────────────────────────────────

/**
 * Rolling ATR-14 series — computes ATR at each candle position for the
 * last `window` candles. Requires at least `window + 14` candles.
 */
function atrSeries(candles: Candle[], window: number): number[] {
  if (candles.length < 15) return [];

  // Compute all true ranges
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }

  // Walk the Wilder-smoothed ATR forward, collecting the last `window` values
  let atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  const series: number[] = [];
  const startCollecting = Math.max(14, trs.length - window);

  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]!) / 14;
    if (i >= startCollecting) series.push(atr);
  }

  return series;
}

/**
 * Detect volatility compression after a big move ("coiled spring").
 *
 * 1. Compute rolling ATR series over last 50 4h candles
 * 2. ATR percentile: where current ATR sits in that distribution
 * 3. ATR ratio: current / mean (< 0.7 = compressed)
 * 4. Recent displacement: max price move (ATR-normalized) in last 30 candles
 * 5. Coiled spring = low ATR percentile + high recent displacement
 */
function analyzeVolatility(candles: Candle[], currentAtr: number): VolatilityContext {
  const LOOKBACK = 50;
  const DISPLACEMENT_WINDOW = 30;

  const series = atrSeries(candles, LOOKBACK);
  if (series.length < 10) {
    return { atr: currentAtr, atrPercentile: 50, atrRatio: 1, recentDisplacement: 0, compressionAfterMove: false };
  }

  // ATR percentile: what fraction of recent ATR values is current ATR below
  const belowCount = series.filter((v) => v <= currentAtr).length;
  const atrPercentile = Math.round((belowCount / series.length) * 100);

  // ATR ratio: current vs mean
  const meanAtr = series.reduce((s, v) => s + v, 0) / series.length;
  const atrRatio = parseFloat((currentAtr / meanAtr).toFixed(3));

  // Recent displacement: max absolute price move over DISPLACEMENT_WINDOW candles,
  // normalized by the mean ATR (so it's in "ATR units")
  const recent = candles.slice(-DISPLACEMENT_WINDOW);
  let maxDisplacement = 0;
  if (recent.length >= 2 && meanAtr > 0) {
    const basePrice = recent[0]!.close;
    for (const c of recent) {
      const disp = Math.abs(c.close - basePrice) / meanAtr;
      if (disp > maxDisplacement) maxDisplacement = disp;
    }
  }
  const recentDisplacement = parseFloat(maxDisplacement.toFixed(2));

  // Coiled spring: ATR in bottom 30th percentile + displacement > 2 ATR units
  const compressionAfterMove = atrPercentile <= 30 && recentDisplacement >= 2;

  return { atr: currentAtr, atrPercentile, atrRatio, recentDisplacement, compressionAfterMove };
}

// ─── Market structure ─────────────────────────────────────────────────────────

interface Pivot {
  index: number;
  value: number;
  time: number;
}

/**
 * Find pivot highs where high[i] > high[i±lookback].
 * ATR filter: only keep pivots whose prominence exceeds minMagnitude.
 * Lookback raised to 3 (7-day pattern) for more significant swing points.
 */
function pivotHighs(candles: Candle[], atrValue: number, lookback = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i]!.high;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j]!.high >= h || candles[i + j]!.high >= h) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    // ATR filter: pivot must rise at least 1× ATR above the lowest adjacent low
    const adjacentLow = Math.min(
      ...Array.from({ length: lookback }, (_, j) => Math.min(candles[i - j - 1]!.low, candles[i + j + 1]!.low))
    );
    if (atrValue > 0 && (h - adjacentLow) < atrValue) continue;
    pivots.push({ index: i, value: h, time: candles[i]!.time });
  }
  return pivots;
}

/**
 * Find pivot lows where low[i] < low[i±lookback].
 * ATR filter: only keep pivots whose depth exceeds minMagnitude.
 */
function pivotLows(candles: Candle[], atrValue: number, lookback = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const l = candles[i]!.low;
    let isPivot = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j]!.low <= l || candles[i + j]!.low <= l) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    // ATR filter: pivot must drop at least 1× ATR below the highest adjacent high
    const adjacentHigh = Math.max(
      ...Array.from({ length: lookback }, (_, j) => Math.max(candles[i - j - 1]!.high, candles[i + j + 1]!.high))
    );
    if (atrValue > 0 && (adjacentHigh - l) < atrValue) continue;
    pivots.push({ index: i, value: l, time: candles[i]!.time });
  }
  return pivots;
}

function detectStructure(dailyCandles: Candle[], atrValue: number): { structure: MarketStructure; lastPivotAge: number | null } {
  // Use last 40 daily candles for pivot detection
  const window = dailyCandles.slice(-40);
  const highs = pivotHighs(window, atrValue);
  const lows = pivotLows(window, atrValue);

  if (highs.length < 2 || lows.length < 2) return { structure: "STRUCTURE_UNKNOWN", lastPivotAge: null };

  const lastHigh = highs.at(-1)!;
  const prevHigh = highs.at(-2)!;
  const lastLow = lows.at(-1)!;
  const prevLow = lows.at(-2)!;

  // Age of the most recent pivot (in candles from end of window)
  const lastPivotIndex = Math.max(lastHigh.index, lastLow.index);
  const lastPivotAge = window.length - 1 - lastPivotIndex;

  const hh = lastHigh.value > prevHigh.value;
  const hl = lastLow.value > prevLow.value;

  let structure: MarketStructure;
  if (hh && hl)       structure = "HH_HL";
  else if (!hh && !hl) structure = "LH_LL";
  else if (hh && !hl)  structure = "HH_LL";
  else                  structure = "LH_HL";

  return { structure, lastPivotAge };
}

// ─── MA cross ────────────────────────────────────────────────────────────────

function detectCross(
  daily: Candle[]
): { current: MaCrossType; recent: MaCrossType } {
  const closes = daily.map((c) => c.close);
  if (closes.length < 201) return { current: "NONE", recent: "NONE" };

  const currentSma50  = sma(closes, 50);
  const currentSma200 = sma(closes, 200);
  const current: MaCrossType = currentSma50 > currentSma200 ? "GOLDEN" : "DEATH";

  // Look back 10 days for a recent cross
  let recent: MaCrossType = "NONE";
  for (let offset = 1; offset <= 10; offset++) {
    const prevCloses = closes.slice(0, closes.length - offset);
    if (prevCloses.length < 200) break;
    const prevSma50  = sma(prevCloses, 50);
    const prevSma200 = sma(prevCloses, 200);
    const prevGolden = prevSma50 > prevSma200;
    const curGolden  = currentSma50 > currentSma200;
    if (prevGolden !== curGolden) {
      recent = curGolden ? "GOLDEN" : "DEATH";
      break;
    }
  }

  return { current, recent };
}

// ─── Signal staleness ─────────────────────────────────────────────────────────

/**
 * Scan 4h RSI values over the short CVD window to find how many candles ago
 * the RSI was most extreme (furthest from 50).
 */
function rsiExtremeStaleness(h4Closes: number[]): number | null {
  const window = h4Closes.slice(-CVD_SHORT_LOOKBACK);
  if (window.length < 14) return null;

  let maxDist = 0;
  let bestIdx = -1;
  for (let i = 14; i < window.length; i++) {
    const r = rsi14(window.slice(0, i + 1));
    const dist = Math.abs(r - 50);
    if (dist >= 20 && dist >= maxDist) { // only track if actually extreme (>70 or <30)
      maxDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return window.length - 1 - bestIdx;
}

/**
 * Scan 4h MFI values over the short window to find how many candles ago
 * the MFI was most extreme (furthest from 50). Threshold 30 points (>80 or <20)
 * since MFI extremes are tighter/more significant than RSI.
 */
function mfiExtremeStaleness(h4Candles: Candle[]): number | null {
  const window = h4Candles.slice(-CVD_SHORT_LOOKBACK);
  if (window.length < 15) return null;

  const curve = mfi14Curve(window);
  let maxDist = 0;
  let bestIdx = -1;
  for (let i = 14; i < curve.length; i++) {
    const dist = Math.abs(curve[i]! - 50);
    if (dist >= 30 && dist >= maxDist) {
      maxDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return window.length - 1 - bestIdx;
}

/**
 * Find how many candles ago the CVD divergence had highest R² product
 * (strongest conviction). Scans sub-windows of the long CVD window.
 */
function cvdDivergencePeakStaleness(candles: Candle[]): number | null {
  const longSlice = candles.slice(-CVD_LONG_LOOKBACK);
  if (longSlice.length < 20) return null;

  let bestR2Product = 0;
  let bestEndIdx = -1;
  // Slide a 20-candle window across the long slice
  for (let end = 20; end <= longSlice.length; end++) {
    const sub = longSlice.slice(end - 20, end);
    const curve = buildCvdCurve(sub);
    const priceReg = linreg(sub.map((c) => c.close));
    const cvdReg = linreg(curve);
    if (priceReg.r2 >= R2_THRESHOLD && cvdReg.r2 >= R2_THRESHOLD) {
      const meanPrice = sub.reduce((s, c) => s + c.close, 0) / sub.length;
      const avgVol = sub.reduce((s, c) => s + c.volume, 0) / sub.length;
      const pSlope = meanPrice === 0 ? 0 : priceReg.slope / meanPrice;
      const cSlope = avgVol === 0 ? 0 : cvdReg.slope / avgVol;
      // Only count if diverging
      if ((pSlope > 0.001 && cSlope < -SLOPE_THRESHOLD) || (pSlope < -0.001 && cSlope > SLOPE_THRESHOLD)) {
        const r2Product = priceReg.r2 * cvdReg.r2;
        if (r2Product > bestR2Product) {
          bestR2Product = r2Product;
          bestEndIdx = end;
        }
      }
    }
  }
  if (bestEndIdx < 0) return null;
  return longSlice.length - bestEndIdx;
}

// ─── Volume Profile ─────────────────────────────────────────────────────────

const VP_BIN_PCT = 0.005;          // 0.5% of price per bin (~$350 at BTC $70k)
const VP_MIN_RANGE_CANDLES = 20;   // minimum candles for meaningful profile
const VP_DISPLACEMENT_SINGLE = 5;  // single-candle displacement threshold (×ATR)
const VP_DISPLACEMENT_WINDOW = 5;  // 3-candle window displacement threshold (×ATR)
const VA_COVERAGE = 0.70;          // Value Area = 70% of total volume

/**
 * Find where the current range started by detecting the most recent displacement.
 *
 * Walks backward through candles looking for:
 *   - Single-candle move: |close - open| > 2×ATR
 *   - 3-candle window move: |close[i] - close[i-2]| > 3×ATR
 *
 * Returns the index of the first candle AFTER the displacement (range start).
 * Guarantees at least VP_MIN_RANGE_CANDLES. Falls back to 0 if no displacement found.
 */
function findRangeStart(candles: Candle[], atr: number): number {
  if (atr <= 0 || candles.length <= VP_MIN_RANGE_CANDLES) return 0;

  for (let i = candles.length - VP_MIN_RANGE_CANDLES; i >= 0; i--) {
    const c = candles[i]!;
    // Single-candle displacement
    if (Math.abs(c.close - c.open) > VP_DISPLACEMENT_SINGLE * atr) {
      return i + 1;
    }
    // 3-candle window displacement
    if (i >= 2) {
      const move = Math.abs(c.close - candles[i - 2]!.close);
      if (move > VP_DISPLACEMENT_WINDOW * atr) {
        return i + 1;
      }
    }
  }

  return 0; // no displacement found — use all candles
}

/**
 * Build a volume profile by distributing each candle's volume uniformly
 * across the price bins it spans (high-low range).
 *
 * Returns Map<binIndex, accumulatedVolume>.
 */
function buildVolumeProfile(candles: Candle[], binSize: number): Map<number, number> {
  const profile = new Map<number, number>();

  for (const c of candles) {
    const lowBin = Math.floor(c.low / binSize);
    const highBin = Math.floor(c.high / binSize);
    const binCount = highBin - lowBin + 1;
    const volumePerBin = c.volume / binCount;

    for (let bin = lowBin; bin <= highBin; bin++) {
      profile.set(bin, (profile.get(bin) ?? 0) + volumePerBin);
    }
  }

  return profile;
}

/**
 * Analyze a volume profile to extract POC, Value Area, HVNs, and LVNs.
 *
 * Value Area (70% rule): expand outward from the POC bin, always adding
 * the side with more volume, until 70% of total volume is captured.
 *
 * HVNs: top 3 bins by volume excluding POC (secondary price magnets).
 * LVNs: bins below 20th percentile volume flanked by higher-volume bins
 * on both sides — valleys in the distribution (acceleration zones).
 */
function analyzeVolumeProfile(
  profile: Map<number, number>,
  binSize: number,
  currentPrice: number,
): VolumeProfileResult {
  if (profile.size === 0) {
    return {
      poc: currentPrice, pocVolumePct: 0,
      vaHigh: currentPrice, vaLow: currentPrice,
      pricePosition: "INSIDE_VA", priceVsPocPct: 0,
      hvns: [], lvns: [],
    };
  }

  const entries = [...profile.entries()].sort((a, b) => a[0] - b[0]);
  const totalVolume = entries.reduce((s, [, v]) => s + v, 0);

  // POC: bin with maximum volume
  let pocBin = entries[0]![0];
  let pocVolume = 0;
  for (const [bin, vol] of entries) {
    if (vol > pocVolume) {
      pocBin = bin;
      pocVolume = vol;
    }
  }
  const poc = parseFloat(((pocBin + 0.5) * binSize).toFixed(2));
  const pocVolumePct = parseFloat(((pocVolume / totalVolume) * 100).toFixed(2));

  // Value Area: expand outward from POC until 70% of volume captured
  const binToVolume = new Map(entries);
  const allBins = entries.map(([b]) => b);
  const pocIdx = allBins.indexOf(pocBin);

  let vaLowIdx = pocIdx;
  let vaHighIdx = pocIdx;
  let vaVolume = pocVolume;

  while (vaVolume / totalVolume < VA_COVERAGE) {
    const canGoLow = vaLowIdx > 0;
    const canGoHigh = vaHighIdx < allBins.length - 1;
    if (!canGoLow && !canGoHigh) break;

    const lowVol = canGoLow ? (binToVolume.get(allBins[vaLowIdx - 1]!) ?? 0) : -1;
    const highVol = canGoHigh ? (binToVolume.get(allBins[vaHighIdx + 1]!) ?? 0) : -1;

    if (lowVol >= highVol) {
      vaLowIdx--;
      vaVolume += lowVol;
    } else {
      vaHighIdx++;
      vaVolume += highVol;
    }
  }

  const vaLow = parseFloat((allBins[vaLowIdx]! * binSize).toFixed(2));
  const vaHigh = parseFloat(((allBins[vaHighIdx]! + 1) * binSize).toFixed(2));

  // Price position
  let pricePosition: VolumeProfilePosition;
  if (currentPrice > vaHigh) pricePosition = "ABOVE_VA";
  else if (currentPrice < vaLow) pricePosition = "BELOW_VA";
  else pricePosition = "INSIDE_VA";

  const priceVsPocPct = parseFloat(((currentPrice / poc - 1) * 100).toFixed(2));

  // HVNs: top 3 by volume, excluding POC
  const hvns = entries
    .filter(([bin]) => bin !== pocBin)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([bin]) => parseFloat(((bin + 0.5) * binSize).toFixed(2)));

  // LVNs: bins below 20th percentile volume flanked by higher-volume bins
  const volumes = entries.map(([, v]) => v);
  const sortedVols = [...volumes].sort((a, b) => a - b);
  const p20 = sortedVols[Math.floor(sortedVols.length * 0.2)] ?? 0;

  const lvns: number[] = [];
  for (let i = 1; i < entries.length - 1; i++) {
    const [bin, vol] = entries[i]!;
    if (vol > p20) continue;
    const leftVol = entries[i - 1]![1];
    const rightVol = entries[i + 1]![1];
    if (leftVol > vol && rightVol > vol) {
      const significance = Math.min(leftVol, rightVol) / Math.max(vol, 0.001);
      lvns.push(significance); // temporarily store significance at this index
      lvns.push(bin);
    }
  }
  // Extract top 3 LVNs by significance
  const lvnPairs: { bin: number; sig: number }[] = [];
  for (let i = 0; i < lvns.length; i += 2) {
    lvnPairs.push({ sig: lvns[i]!, bin: lvns[i + 1]! });
  }
  const topLvns = lvnPairs
    .sort((a, b) => b.sig - a.sig)
    .slice(0, 3)
    .map((p) => parseFloat(((p.bin + 0.5) * binSize).toFixed(2)));

  return { poc, pocVolumePct, vaHigh, vaLow, pricePosition, priceVsPocPct, hvns, lvns: topLvns };
}

/**
 * Compute the displacement-anchored volume profile context.
 *
 * 1. Detect where the current range started (last displacement)
 * 2. Build + analyze the volume profile from range start to now
 */
// Hardcoded range anchor: the Feb 4 displacement marks the start of the
// current trading range for both BTC and ETH.
const VP_RANGE_ANCHOR = new Date("2026-02-04T00:00:00Z").getTime();

function computeVolumeProfileContext(
  futuresCandles: Candle[],
  atr: number,
  currentPrice: number,
): VolumeProfileContext {
  const binSize = currentPrice * VP_BIN_PCT;
  const anchorIdx = futuresCandles.findIndex(c => c.time >= VP_RANGE_ANCHOR);
  const rangeStartIdx = anchorIdx >= 0 ? anchorIdx : findRangeStart(futuresCandles, atr);
  const rangeCandles = futuresCandles.slice(rangeStartIdx);

  const profileMap = buildVolumeProfile(rangeCandles, binSize);
  const profile = analyzeVolumeProfile(profileMap, binSize, currentPrice);

  return {
    profile,
    rangeStartCandles: futuresCandles.length - rangeStartIdx,
  };
}

// ─── Liquidity Sweep Levels ─────────────────────────────────────────────────

const SWEEP_MIN_AGE_DAYS = 3; // ignore levels formed in the last 3 days
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute liquidity sweep levels from calendar weekly/monthly highs and lows.
 *
 * Stale highs/lows accumulate stop orders over time, making them progressively
 * stronger price magnets. Sweep attraction = distancePct × log2(ageDays).
 */
function computeSweepLevels(dailyCandles: Candle[], currentPrice: number): SweepContext {
  if (dailyCandles.length < 7) {
    return { levels: [], nearestHigh: null, nearestLow: null };
  }

  const now = Date.now();
  const raw: SweepLevel[] = [];

  // Group candles by calendar period
  const monthGroups = new Map<string, Candle[]>();
  const weekGroups = new Map<string, Candle[]>();

  for (const c of dailyCandles) {
    const d = new Date(c.time);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const weekKey = isoWeekKey(d);

    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, []);
    monthGroups.get(monthKey)!.push(c);

    if (!weekGroups.has(weekKey)) weekGroups.set(weekKey, []);
    weekGroups.get(weekKey)!.push(c);
  }

  // Only track the current forming period — resets when a new month/week starts.
  const nowDate = new Date(now);
  const currentMonthKey = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const currentWeekKey = isoWeekKey(nowDate);

  if (monthGroups.has(currentMonthKey)) {
    addPeriodLevels(raw, monthGroups.get(currentMonthKey)!, "MONTHLY", currentPrice, now);
  }
  if (weekGroups.has(currentWeekKey)) {
    addPeriodLevels(raw, weekGroups.get(currentWeekKey)!, "WEEKLY", currentPrice, now);
  }

  // Filter: HIGHs only above price (unswept highs to sweep upward),
  //         LOWs only below price (unswept lows to sweep downward)
  const directional = raw.filter(
    (l) => (l.type === "HIGH" && l.price > currentPrice) || (l.type === "LOW" && l.price < currentPrice),
  );

  // Deduplicate: if weekly and monthly levels are within 0.5%, keep higher attraction
  const deduped = deduplicateLevels(directional);

  // Sort by attraction descending
  deduped.sort((a, b) => b.attraction - a.attraction);

  // Find nearest high/low by highest attraction
  const nearestHigh = deduped.find((l) => l.type === "HIGH") ?? null;
  const nearestLow = deduped.find((l) => l.type === "LOW") ?? null;

  return { levels: deduped, nearestHigh, nearestLow };
}

/** ISO week key: YYYY-Www */
function isoWeekKey(d: Date): string {
  // ISO week: Monday-based, week 1 contains Jan 4
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Extract high and low candles from a period, compute sweep levels. */
function addPeriodLevels(
  out: SweepLevel[],
  candles: Candle[],
  period: SweepPeriod,
  currentPrice: number,
  now: number,
): void {
  let highCandle = candles[0]!;
  let lowCandle = candles[0]!;
  for (const c of candles) {
    if (c.high > highCandle.high) highCandle = c;
    if (c.low < lowCandle.low) lowCandle = c;
  }

  for (const [candle, type, price] of [
    [highCandle, "HIGH" as SweepLevelType, highCandle.high],
    [lowCandle, "LOW" as SweepLevelType, lowCandle.low],
  ] as const) {
    const ageDays = (now - candle.time) / MS_PER_DAY;
    if (ageDays < SWEEP_MIN_AGE_DAYS) return;

    const distancePct = parseFloat((Math.abs(currentPrice / price - 1) * 100).toFixed(2));
    // Closer + older = higher attraction (more likely to be swept)
    const attraction = parseFloat(((Math.log2(Math.max(ageDays, 1)) / (distancePct + 0.5)) * 100).toFixed(2));

    out.push({
      price: parseFloat(price.toFixed(2)),
      type,
      period,
      ageDays: parseFloat(ageDays.toFixed(1)),
      distancePct,
      attraction,
    });
  }
}

/** Remove near-duplicate levels (within 0.5%), keeping the one with higher attraction. */
function deduplicateLevels(levels: SweepLevel[]): SweepLevel[] {
  // Sort by price to make dedup easy
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const result: SweepLevel[] = [];

  for (const level of sorted) {
    const existing = result.find(
      (r) => r.type === level.type && Math.abs(r.price / level.price - 1) < 0.005,
    );
    if (existing) {
      // Keep higher attraction
      if (level.attraction > existing.attraction) {
        result.splice(result.indexOf(existing), 1, level);
      }
    } else {
      result.push(level);
    }
  }

  return result;
}

// ─── Event detection ─────────────────────────────────────────────────────────

function detectEvents(
  snapshot: HtfSnapshot,
  price: number,
  sma200: number,
  rsi: RsiContext,
  mfi: MfiContext,
  cross: { current: MaCrossType; recent: MaCrossType },
  structure: MarketStructure,
  cvd: CvdContext,
  confluence: DivergenceConfluence,
  sth: SthContext,
  prevState: HtfState | null
): HtfEvent[] {
  const events: HtfEvent[] = [];
  const at = snapshot.timestamp;

  // MA cross events
  if (cross.recent === "GOLDEN") {
    events.push({ type: "golden_cross", detail: "50 DMA crossed above 200 DMA", at });
  } else if (cross.recent === "DEATH") {
    events.push({ type: "death_cross", detail: "50 DMA crossed below 200 DMA", at });
  }

  // 200 DMA cross (price) — check on 4h candles
  if (prevState) {
    const candles = snapshot.h4Candles;
    if (candles.length >= 2) {
      const prevClose = candles.at(-2)!.close;
      const prevBelow = prevClose < sma200;
      const nowAbove  = price > sma200;
      if (prevBelow && nowAbove) {
        events.push({ type: "dma200_reclaim", detail: `Price reclaimed 200 DMA ($${sma200.toFixed(0)})`, at });
      } else if (!prevBelow && !nowAbove) {
        events.push({ type: "dma200_break", detail: `Price broke below 200 DMA ($${sma200.toFixed(0)})`, at });
      }
    }
  }

  // STH cost-basis cross — price crossing the 155-day VWAP
  if (prevState) {
    const prevClose = snapshot.h4Candles.at(-2)!.close;
    const prevBelowSth = prevClose < sth.price;
    const nowAboveSth  = price > sth.price;
    if (prevBelowSth && nowAboveSth) {
      events.push({
        type: "sth_reclaim",
        detail: `Price reclaimed STH cost basis ($${sth.price.toFixed(0)}) — average recent buyer now in profit`,
        at,
      });
    } else if (!prevBelowSth && !nowAboveSth) {
      events.push({
        type: "sth_break",
        detail: `Price broke below STH cost basis ($${sth.price.toFixed(0)}) — average recent buyer now underwater`,
        at,
      });
    }
  }

  // Daily RSI extremes
  if (rsi.daily > 70) {
    events.push({ type: "rsi_daily_overbought", detail: `Daily RSI at ${rsi.daily}`, at });
  } else if (rsi.daily < 30) {
    events.push({ type: "rsi_daily_oversold", detail: `Daily RSI at ${rsi.daily}`, at });
  }

  // MFI extremes — tighter thresholds than RSI (80/20 vs 70/30) since MFI extremes
  // inherently require volume participation and are therefore more significant.
  if (mfi.h4 > 80) {
    events.push({
      type: "mfi_overbought",
      detail: `4h MFI at ${mfi.h4} — volume-confirmed overbought, stronger signal than RSI alone`,
      at,
    });
  } else if (mfi.h4 < 20) {
    events.push({
      type: "mfi_oversold",
      detail: `4h MFI at ${mfi.h4} — volume-confirmed oversold, stronger signal than RSI alone`,
      at,
    });
  }

  // RSI divergence (price/RSI swing-point disagreement on 4h)
  if (rsi.divergence === "BULLISH") {
    events.push({
      type: "rsi_divergence_bullish",
      detail: "Price making lower lows but RSI higher lows — momentum exhausting on downside",
      at,
    });
  } else if (rsi.divergence === "BEARISH") {
    events.push({
      type: "rsi_divergence_bearish",
      detail: "Price making higher highs but RSI lower highs — momentum exhausting on upside",
      at,
    });
  }

  // MFI divergence — the volume-weighted exhaustion signal
  if (mfi.divergence === "BULLISH") {
    events.push({
      type: "mfi_divergence_bullish",
      detail: "Price making lower lows but MFI higher lows — selling on declining volume",
      at,
    });
  } else if (mfi.divergence === "BEARISH") {
    events.push({
      type: "mfi_divergence_bearish",
      detail: "Price making higher highs but MFI lower highs — rally on declining volume",
      at,
    });
  }

  // Divergence confluence — the primary mean reversion trigger when 2+ indicators agree
  if (confluence.direction !== "NONE" && confluence.sources.length >= 2) {
    const srcs = confluence.sources.map((s) => s.indicator).join(", ");
    const type = confluence.direction === "BULLISH"
      ? "divergence_confluence_bullish"
      : "divergence_confluence_bearish";
    events.push({
      type,
      detail: `${confluence.sources.length}-indicator ${confluence.direction.toLowerCase()} divergence confluence `
        + `(strength ${confluence.strength.toFixed(2)}) — ${srcs}`,
      at,
    });
  }

  // Structure shift
  if (prevState && prevState.lastStructure !== structure && structure !== "STRUCTURE_UNKNOWN") {
    if (structure === "HH_HL") {
      events.push({ type: "structure_shift_bullish", detail: `Structure shifted to ${structure}`, at });
    } else if (structure === "LH_LL") {
      events.push({ type: "structure_shift_bearish", detail: `Structure shifted to ${structure}`, at });
    }
  }

  // CVD divergence events (futures pivot-based — the authoritative reversal signal)
  if (cvd.futures.divergence === "BULLISH") {
    const mech = cvd.futures.divergenceMechanism === "ABSORPTION"
      ? "CVD making lower lows while price holds — sellers being absorbed"
      : "price making lower lows but CVD holds — seller exhaustion";
    events.push({
      type: "cvd_divergence_bullish",
      detail: `Bullish CVD divergence (${cvd.futures.divergenceMechanism}): ${mech}`,
      at,
    });
  } else if (cvd.futures.divergence === "BEARISH") {
    const mech = cvd.futures.divergenceMechanism === "ABSORPTION"
      ? "CVD making higher highs while price stalls — buyers being absorbed"
      : "price making higher highs but CVD stalls — buyer exhaustion";
    events.push({
      type: "cvd_divergence_bearish",
      detail: `Bearish CVD divergence (${cvd.futures.divergenceMechanism}): ${mech}`,
      at,
    });
  }

  // Spot vs futures CVD divergence — detect short-covering bounces
  if (cvd.spotFuturesDivergence === "SUSPECT_BOUNCE") {
    events.push({
      type: "cvd_suspect_bounce",
      detail: "Futures CVD rising but spot CVD flat/falling — bounce likely short covering, no real demand",
      at,
    });
  }

  // CVD extreme (overbought/oversold spike within swing structure)
  if (cvd.futures.extreme.state === "OVERBOUGHT") {
    events.push({
      type: "cvd_overbought",
      detail: `Futures CVD overbought spike — change at ${cvd.futures.extreme.changePctile}th percentile, `
        + `${cvd.futures.extreme.extensionPct.toFixed(1)}% extension beyond last swing high`,
      at,
    });
  } else if (cvd.futures.extreme.state === "OVERSOLD") {
    events.push({
      type: "cvd_oversold",
      detail: `Futures CVD oversold spike — change at ${cvd.futures.extreme.changePctile}th percentile, `
        + `${cvd.futures.extreme.extensionPct.toFixed(1)}% extension beyond last swing low`,
      at,
    });
  }

  return events;
}

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Regime determination with RANGING split into ACCUMULATION/DISTRIBUTION.
 *
 * When price is below both MAs and doesn't qualify for directional regimes,
 * CVD trend distinguishes:
 *   - ACCUMULATION: futures CVD long-window RISING (buying into weakness)
 *   - DISTRIBUTION: futures CVD long-window DECLINING (selling into range)
 *   - RANGING: CVD FLAT (no directional pressure)
 */
function determineRegime(
  price: number,
  sma50: number,
  sma200: number,
  dailyRsi: number,
  structure: MarketStructure,
  futuresCvdLong: CvdWindow
): HtfRegime {
  const aboveSma200 = price > sma200;
  const aboveSma50  = price > sma50;

  if (aboveSma200) {
    if (dailyRsi > 70) return "BULL_EXTENDED";
    return "MACRO_BULLISH";
  }

  if (aboveSma50 && !aboveSma200) return "RECLAIMING";

  // Below both MAs
  if (dailyRsi < 30) return "BEAR_EXTENDED";
  if (structure === "LH_LL") return "MACRO_BEARISH";

  // Split RANGING by CVD trend — distinguishes accumulation from distribution
  if (futuresCvdLong.regime === "RISING") return "ACCUMULATION";
  if (futuresCvdLong.regime === "DECLINING") return "DISTRIBUTION";

  return "RANGING";
}

// ─── Continuous bias scores ──────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const BIAS_W_TREND = 0.10;
const BIAS_W_MOMENTUM = 0.20;
const BIAS_W_FLOW = 0.20;
const BIAS_W_COMPRESSION = 0.30;
// VP is shorter-term (displacement-anchored range) → higher probability near-term signal.
// STH is longer-term (155d behavioral cost basis) → directional context, not timing.
const BIAS_W_VP = 0.14;
const BIAS_W_STH = 0.06;

/**
 * Compute continuous bias scores from already-computed HTF indicators.
 *
 * Each component is -1..+1 (positive = bullish), except compression which is
 * 0..1 (unsigned energy). The composite is a weighted blend where compression
 * amplifies the direction of the other signals rather than adding its own.
 */
function computeBias(
  ma: MaContext,
  rsi: RsiContext,
  mfi: MfiContext,
  cvd: CvdContext,
  confluence: DivergenceConfluence,
  vol: VolatilityContext,
  vp: VolumeProfileContext | null,
  sth: SthContext,
): HtfBias {
  // 1. Trend — MA mean-reversion pull.
  //    Below MAs = bullish pull (positive), above = bearish pull (negative).
  //    SMA200 is the stronger structural magnet.
  const sma50Pull = clamp(-ma.priceVsSma50Pct / 6, -1, 1) * 0.4;
  const sma200Pull = clamp(-ma.priceVsSma200Pct / 10, -1, 1) * 0.6;
  const trend = clamp(sma50Pull + sma200Pull, -1, 1);

  // 2. Momentum — RSI + MFI distance from 50, non-linear.
  //    Oversold (<50) = bullish setup (positive). Blend 4h (70%) and daily (30%).
  //    MFI weighted slightly above RSI — volume-confirmed momentum is more reliable
  //    for mean reversion. Daily MFI dominates further because swing signals need
  //    stronger volume conviction.
  const rsiDev4h = (50 - rsi.h4) / 50;          // +1 at RSI=0, -1 at RSI=100
  const rsiDevDaily = (50 - rsi.daily) / 50;
  const mfiDev4h = (50 - mfi.h4) / 50;
  const mfiDevDaily = (50 - mfi.daily) / 50;
  const h4Momentum = rsiDev4h * 0.45 + mfiDev4h * 0.55;
  const dailyMomentum = rsiDevDaily * 0.40 + mfiDevDaily * 0.60;
  const rsiLinear = clamp(h4Momentum * 0.7 + dailyMomentum * 0.3, -1, 1);
  const momentum = Math.sign(rsiLinear) * Math.pow(Math.abs(rsiLinear), 0.6);

  // 3. Flow — CVD order flow + magnitude-weighted divergence confluence.
  //    Base signal comes from CVD regime direction weighted by magnitude & confidence.
  //    Confluence (MFI + RSI + CVD divergences) layered on top as a reversal amplifier.
  let flow = 0;
  const { futures, spot, spotFuturesDivergence } = cvd;

  // Base flow from CVD regime direction.
  // Short window captures the current move, long window the structural trend.
  // Futures weighted 60%, spot 40%.
  const regimeSign = (w: CvdWindow): number =>
    w.regime === "RISING" ? 1 : w.regime === "DECLINING" ? -1 : 0;
  const windowScore = (w: CvdWindow): number =>
    regimeSign(w) * clamp(Math.abs(w.slope) / 0.01, 0.2, 1.0) * (0.4 + w.r2 * 0.6);

  const futuresBase = windowScore(futures.short) * 0.6 + windowScore(futures.long) * 0.4;
  const spotBase    = windowScore(spot.short) * 0.6 + windowScore(spot.long) * 0.4;
  flow = futuresBase * 0.6 + spotBase * 0.4;

  // Divergence confluence boost — magnitude-weighted, replaces independent per-indicator boosts.
  // strength is already 0-1 with magnitude baked in. Max boost scales to 0.70 to match
  // the prior maximum combined boost (futures 0.30×1.25 + spot 0.15×1.4 ≈ 0.58 under old system).
  if (confluence.direction !== "NONE") {
    const sign = confluence.direction === "BULLISH" ? 1 : -1;
    flow += sign * confluence.strength * 0.70;

    // Preserve CVD mechanism nuance: absorption > exhaustion when CVD futures participates
    const cvdFutInConfluence = confluence.sources.some((s) => s.indicator === "cvd_futures");
    if (cvdFutInConfluence) {
      if (futures.divergenceMechanism === "ABSORPTION") flow *= 1.15;
      else if (futures.divergenceMechanism === "EXHAUSTION") flow *= 0.90;
    }
  }

  // CVD extreme — overbought/oversold spike counters the prevailing direction.
  // OVERBOUGHT in a RISING structure = buyers exhausting, contrarian bearish.
  // OVERSOLD in a DECLINING structure = sellers exhausting, contrarian bullish.
  // Magnitude scales with how extreme the percentile is beyond the threshold.
  if (futures.extreme.state === "OVERBOUGHT") {
    const depth = clamp((futures.extreme.changePctile - CVD_EXTREME_PCTILE) / (100 - CVD_EXTREME_PCTILE), 0, 1);
    const ext = clamp(futures.extreme.extensionPct / 20, 0, 1);
    flow -= 0.3 * (0.6 * depth + 0.4 * ext); // pushes bearish
  } else if (futures.extreme.state === "OVERSOLD") {
    const depth = clamp(((100 - CVD_EXTREME_PCTILE) - futures.extreme.changePctile) / (100 - CVD_EXTREME_PCTILE), 0, 1);
    const ext = clamp(futures.extreme.extensionPct / 20, 0, 1);
    flow += 0.3 * (0.6 * depth + 0.4 * ext); // pushes bullish
  }

  // Spot-futures alignment modifier
  const alignmentMult =
    spotFuturesDivergence === "CONFIRMED_BUYING" || spotFuturesDivergence === "CONFIRMED_SELLING" ? 1.0
    : spotFuturesDivergence === "SPOT_LEADS" ? 0.85
    : spotFuturesDivergence === "SUSPECT_BOUNCE" ? 0.6
    : 0.90;
  flow = clamp(flow * alignmentMult, -1, 1);

  // 4. Compression — volatility energy (unsigned 0..1).
  let compression = 0;
  if (vol.compressionAfterMove) {
    const compressionStrength = (30 - vol.atrPercentile) / 30;
    const displacementStrength = clamp((vol.recentDisplacement - 2) / 3, 0, 1);
    compression = 0.5 + compressionStrength * 0.25 + displacementStrength * 0.25;
  } else if (vol.atrRatio < 0.7) {
    compression = 0.6 * ((0.7 - vol.atrRatio) / 0.3);
  }
  compression = clamp(compression, 0, 1);

  // 5. VP gravity — mean-reversion pull toward POC, non-linear.
  //    Power curve (^0.6) amplifies moderate deviations: 3% from POC → 0.74 instead of 0.60.
  let vpGravity = 0;
  if (vp) {
    const vpLinear = clamp(-vp.profile.priceVsPocPct / 5, -1, 1);
    const vpNonLinear = Math.sign(vpLinear) * Math.pow(Math.abs(vpLinear), 0.6);
    vpGravity = vpNonLinear * clamp(vp.profile.pocVolumePct / 5, 0.5, 1.5);
    vpGravity = clamp(vpGravity, -1, 1);
  }

  // 6. STH gravity — mean-reversion pull toward 155-day VWAP cost basis.
  //    Behavioral anchor: holders break-even psychology creates absorption zones.
  //    15% away from STH = full saturation (same power curve as vpGravity).
  const sthLinear = clamp(-sth.priceVsSthPct / 15, -1, 1);
  const sthGravity = clamp(Math.sign(sthLinear) * Math.pow(Math.abs(sthLinear), 0.6), -1, 1);

  // Composite: compression is unsigned — it amplifies the directional signals.
  // First compute the directional blend without compression:
  const directional =
    trend * BIAS_W_TREND +
    momentum * BIAS_W_MOMENTUM +
    flow * BIAS_W_FLOW +
    vpGravity * BIAS_W_VP +
    sthGravity * BIAS_W_STH;

  // Compression scales the directional signal: 0 compression = 1× (no effect),
  // max compression = up to 2.0× amplification.
  const compressionMult = 1 + compression * 1.0;
  const composite = clamp(directional * compressionMult / (1 - BIAS_W_COMPRESSION), -1, 1);

  return {
    trend: parseFloat(trend.toFixed(3)),
    momentum: parseFloat(momentum.toFixed(3)),
    flow: parseFloat(flow.toFixed(3)),
    compression: parseFloat(compression.toFixed(3)),
    vpGravity: parseFloat(vpGravity.toFixed(3)),
    sthGravity: parseFloat(sthGravity.toFixed(3)),
    composite: parseFloat(composite.toFixed(3)),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function analyze(
  snapshot: HtfSnapshot,
  prevState: HtfState | null
): { context: HtfContext; nextState: HtfState } {
  const h4     = snapshot.h4Candles;
  const daily  = snapshot.dailyCandles;
  const price  = h4.at(-1)!.close;

  const h4Closes    = h4.map((c) => c.close);
  const dailyCloses = daily.map((c) => c.close);

  // SMA 50/200 and cross detection on 4h — the execution timeframe
  const sma50  = sma(h4Closes, 50);
  const sma200 = sma(h4Closes, 200);
  const priceVsSma50Pct  = parseFloat(((price / sma50  - 1) * 100).toFixed(2));
  const priceVsSma200Pct = parseFloat(((price / sma200 - 1) * 100).toFixed(2));

  // RSI on both timeframes + 4h divergence
  const rsiH4    = rsi14(h4Closes);
  const rsiDaily = rsi14(dailyCloses);
  const rsiDiv   = detectRsiDivergence(h4);

  // MFI (Money Flow Index) — volume-weighted momentum on both timeframes
  // + 4h divergence for volume-confirmed exhaustion signals.
  const mfiH4    = mfi14(h4);
  const mfiDaily = mfi14(daily);
  const mfiDiv   = detectMfiDivergence(h4);

  // ATR-14 on 4h candles — volatility context on the execution timeframe
  const h4Atr = atr14(h4);
  // ATR-14 on daily candles — used internally for pivot filtering (pivots are daily)
  const dailyAtr = atr14(daily);

  // CVD — dual-window regime detection + pivot-based divergence
  // Futures is authoritative for reversal signals (leveraged intent).
  // Spot is used alongside futures to detect short-covering vs real demand.
  const futuresCvd = cvdAnalysis(snapshot.futuresH4Candles);
  const spotCvd    = cvdAnalysis(h4);
  const cvdData: CvdContext = {
    futures: futuresCvd,
    spot:    spotCvd,
    spotFuturesDivergence: computeSpotFuturesDivergence(spotCvd.short, futuresCvd.short),
  };

  // Magnitudes for CVD divergences (sampled at price pivots, same scale as MFI/RSI)
  const futuresCvdCurve = buildCvdCurve(snapshot.futuresH4Candles.slice(-CVD_LONG_LOOKBACK));
  const spotCvdCurve = buildCvdCurve(h4.slice(-CVD_LONG_LOOKBACK));
  const cvdFutMag = cvdDivergenceMagnitude(
    snapshot.futuresH4Candles.slice(-CVD_LONG_LOOKBACK),
    futuresCvdCurve,
    futuresCvd.divergence,
  );
  const cvdSpotMag = cvdDivergenceMagnitude(
    h4.slice(-CVD_LONG_LOOKBACK),
    spotCvdCurve,
    spotCvd.divergence,
  );

  // Multi-indicator divergence confluence — magnitude-weighted
  const divergenceConfluence = computeDivergenceConfluence(
    mfiDiv,
    rsiDiv,
    { direction: futuresCvd.divergence, magnitude: cvdFutMag },
    { direction: spotCvd.divergence, magnitude: cvdSpotMag },
  );

  // Anchored VWAPs — weekly (Monday 00:00 UTC) and monthly (1st 00:00 UTC)
  const now = new Date(snapshot.timestamp);
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const vwapData: VwapContext = {
    weekly:  anchoredVwap(h4, weekStart.getTime()),
    monthly: anchoredVwap(h4, monthStart.getTime()),
  };

  // Structure from daily candles — ATR-filtered pivots with lookback=3
  const { structure, lastPivotAge } = detectStructure(daily, dailyAtr);
  const cross = detectCross(h4);

  const ma: MaContext = {
    sma50:  parseFloat(sma50.toFixed(2)),
    sma200: parseFloat(sma200.toFixed(2)),
    priceVsSma50Pct,
    priceVsSma200Pct,
    crossType:   cross.current,
    recentCross: cross.recent,
  };

  const rsi: RsiContext = { daily: rsiDaily, h4: rsiH4, divergence: rsiDiv.direction };
  const mfi: MfiContext = { daily: mfiDaily, h4: mfiH4, divergence: mfiDiv.direction };

  const regime = determineRegime(price, sma50, sma200, rsiDaily, structure, cvdData.futures.long);

  const since = prevState?.regime === regime ? prevState.since : snapshot.timestamp;
  const durationDays = Math.max(
    0,
    Math.round((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24))
  );
  const previousRegime =
    prevState?.regime !== regime
      ? (prevState?.regime ?? null)
      : (prevState?.previousRegime ?? null);

  const sth = computeSthProxy(daily, price);

  const events = detectEvents(
    snapshot, price, sma200, rsi, mfi, cross, structure, cvdData, divergenceConfluence, sth, prevState,
  );

  // Signal staleness — how fresh each key signal is
  const staleness: SignalStaleness = {
    rsiExtreme: rsiExtremeStaleness(h4Closes),
    mfiExtreme: mfiExtremeStaleness(h4),
    cvdDivergencePeak: cvdDivergencePeakStaleness(snapshot.futuresH4Candles),
    lastPivot: lastPivotAge,
  };

  const volatility = analyzeVolatility(h4, h4Atr);
  const volumeProfile = computeVolumeProfileContext(snapshot.futuresH4Candles, h4Atr, price);

  const context: HtfContext = {
    asset: snapshot.asset,
    regime,
    since,
    durationDays,
    previousRegime,
    price: parseFloat(price.toFixed(2)),
    ma,
    rsi,
    mfi,
    cvd: cvdData,
    divergenceConfluence,
    vwap: vwapData,
    structure,
    events,
    atr: h4Atr,
    volatility,
    volumeProfile,
    sweep: computeSweepLevels(daily, price),
    staleness,
    sth,
    bias: computeBias(ma, rsi, mfi, cvdData, divergenceConfluence, volatility, volumeProfile, sth),
  };

  const nextState: HtfState = {
    asset: snapshot.asset,
    regime,
    since,
    previousRegime,
    lastUpdated: snapshot.timestamp,
    lastStructure: structure,
  };

  return { context, nextState };
}
