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
  CvdRegime,
  CvdSeries,
  CvdWindow,
  HtfContext,
  HtfEvent,
  HtfRegime,
  HtfSnapshot,
  HtfState,
  MaContext,
  MaCrossType,
  MarketStructure,
  RsiContext,
  SignalStaleness,
  VolatilityContext,
  VwapContext,
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
function buildCvdCurve(candles: Candle[]): number[] {
  const curve: number[] = [];
  let running = 0;
  for (const c of candles) {
    running += 2 * c.takerBuyVolume - c.volume;
    curve.push(running);
  }
  return curve;
}

/** Classify a CVD window into a regime using slope + R². */
function classifyWindow(candles: Candle[], cvdCurve: number[]): CvdWindow {
  const n = candles.length;
  if (n < 10) return { regime: "FLAT", slope: 0, r2: 0 };

  const { slope, r2 } = linreg(cvdCurve);

  const avgVolume = candles.reduce((s, c) => s + c.volume, 0) / n;
  const normalizedSlope = avgVolume === 0 ? 0 : parseFloat((slope / avgVolume).toFixed(6));

  let regime: CvdRegime = "FLAT";
  if (Math.abs(normalizedSlope) >= SLOPE_THRESHOLD && r2 >= R2_THRESHOLD) {
    regime = normalizedSlope > 0 ? "RISING" : "DECLINING";
  }

  return { regime, slope: normalizedSlope, r2 };
}

/**
 * Detect price–CVD divergence over a window.
 *
 * Compares the linear-regression slope of price closes vs CVD curve.
 * Both must show a confident trend (R² ≥ 0.3) in opposite directions.
 *   price rising  + CVD declining → BEARISH (distribution)
 *   price falling + CVD rising    → BULLISH (accumulation)
 */
function detectDivergence(
  candles: Candle[],
  cvdCurve: number[]
): CvdDivergence {
  if (candles.length < 10) return "NONE";

  const priceReg = linreg(candles.map((c) => c.close));
  const cvdReg   = linreg(cvdCurve);

  // Both trends must be confident
  if (priceReg.r2 < R2_THRESHOLD || cvdReg.r2 < R2_THRESHOLD) return "NONE";

  // Normalize price slope the same way: per-unit of mean price
  const meanPrice = candles.reduce((s, c) => s + c.close, 0) / candles.length;
  const pSlope = meanPrice === 0 ? 0 : priceReg.slope / meanPrice;

  const avgVolume = candles.reduce((s, c) => s + c.volume, 0) / candles.length;
  const cSlope = avgVolume === 0 ? 0 : cvdReg.slope / avgVolume;

  // Both must have meaningful magnitude and opposite signs
  if (Math.abs(pSlope) < 0.001 || Math.abs(cSlope) < SLOPE_THRESHOLD) return "NONE";

  if (pSlope > 0 && cSlope < 0) return "BEARISH";
  if (pSlope < 0 && cSlope > 0) return "BULLISH";

  return "NONE";
}

/**
 * Full CVD analysis: dual-window regime + divergence.
 *
 * Short window (20 candles ≈ 3.3d): detects early regime shifts for entries.
 * Long window  (75 candles ≈ 12.5d): confirms the trend across a swing hold.
 * Divergence checked on the long window — more reliable over larger samples.
 */
function cvdAnalysis(candles: Candle[]): CvdSeries {
  const longSlice  = candles.slice(-CVD_LONG_LOOKBACK);
  const shortSlice = longSlice.slice(-CVD_SHORT_LOOKBACK);

  const longCurve  = buildCvdCurve(longSlice);
  const shortCurve = buildCvdCurve(shortSlice);

  const longWindow  = classifyWindow(longSlice, longCurve);
  const shortWindow = classifyWindow(shortSlice, shortCurve);

  const value = longCurve.length > 0 ? parseFloat(longCurve.at(-1)!.toFixed(2)) : 0;
  const divergence = detectDivergence(longSlice, longCurve);

  return { value, short: shortWindow, long: longWindow, divergence };
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

// ─── Event detection ─────────────────────────────────────────────────────────

function detectEvents(
  snapshot: HtfSnapshot,
  price: number,
  sma200: number,
  rsi: RsiContext,
  cross: { current: MaCrossType; recent: MaCrossType },
  structure: MarketStructure,
  cvd: CvdContext,
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

  // Daily RSI extremes
  if (rsi.daily > 70) {
    events.push({ type: "rsi_daily_overbought", detail: `Daily RSI at ${rsi.daily}`, at });
  } else if (rsi.daily < 30) {
    events.push({ type: "rsi_daily_oversold", detail: `Daily RSI at ${rsi.daily}`, at });
  }

  // Structure shift
  if (prevState && prevState.lastStructure !== structure && structure !== "STRUCTURE_UNKNOWN") {
    if (structure === "HH_HL") {
      events.push({ type: "structure_shift_bullish", detail: `Structure shifted to ${structure}`, at });
    } else if (structure === "LH_LL") {
      events.push({ type: "structure_shift_bearish", detail: `Structure shifted to ${structure}`, at });
    }
  }

  // CVD divergence events (futures-only — the authoritative reversal signal)
  if (cvd.futures.divergence === "BULLISH") {
    events.push({
      type: "cvd_divergence_bullish",
      detail: `Futures CVD rising while price falling (R²=${cvd.futures.long.r2}) — accumulation divergence`,
      at,
    });
  } else if (cvd.futures.divergence === "BEARISH") {
    events.push({
      type: "cvd_divergence_bearish",
      detail: `Futures CVD declining while price rising (R²=${cvd.futures.long.r2}) — distribution divergence`,
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

  // RSI on both timeframes
  const rsiH4    = rsi14(h4Closes);
  const rsiDaily = rsi14(dailyCloses);

  // ATR-14 on 4h candles — volatility context on the execution timeframe
  const h4Atr = atr14(h4);
  // ATR-14 on daily candles — used internally for pivot filtering (pivots are daily)
  const dailyAtr = atr14(daily);

  // CVD — dual-window regime detection + price divergence
  // Fix #2: use futures candles for the primary reversal signal (leveraged intent),
  // spot CVD kept for reference but futures is authoritative for divergence.
  const cvdData: CvdContext = {
    futures: cvdAnalysis(snapshot.futuresH4Candles),
    spot:    cvdAnalysis(h4),
  };

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

  const rsi: RsiContext = { daily: rsiDaily, h4: rsiH4 };

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

  const events = detectEvents(snapshot, price, sma200, rsi, cross, structure, cvdData, prevState);

  // Signal staleness — how fresh each key signal is
  const staleness: SignalStaleness = {
    rsiExtreme: rsiExtremeStaleness(h4Closes),
    cvdDivergencePeak: cvdDivergencePeakStaleness(snapshot.futuresH4Candles),
    lastPivot: lastPivotAge,
  };

  const context: HtfContext = {
    asset: snapshot.asset,
    regime,
    since,
    durationDays,
    previousRegime,
    price: parseFloat(price.toFixed(2)),
    ma,
    rsi,
    cvd: cvdData,
    vwap: vwapData,
    structure,
    events,
    atr: h4Atr,
    volatility: analyzeVolatility(h4, h4Atr),
    staleness,
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
