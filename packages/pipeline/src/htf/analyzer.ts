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
  HtfContext,
  HtfEvent,
  HtfRegime,
  HtfSnapshot,
  HtfState,
  MaContext,
  MaCrossType,
  MarketStructure,
  RsiContext,
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

/**
 * Cumulative Volume Delta over the last N candles.
 * delta per candle = takerBuyVolume − (volume − takerBuyVolume) = 2·takerBuyVolume − volume
 */
function cvd(candles: Candle[], lookback = 50): number {
  const window = candles.slice(-lookback);
  return parseFloat(
    window.reduce((sum, c) => sum + (2 * c.takerBuyVolume - c.volume), 0).toFixed(2)
  );
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

// ─── Market structure ─────────────────────────────────────────────────────────

interface Pivot {
  index: number;
  value: number;
  time: number;
}

/** Find pivot highs where high[i] > high[i±lookback] */
function pivotHighs(candles: Candle[], lookback = 2): Pivot[] {
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
    if (isPivot) pivots.push({ index: i, value: h, time: candles[i]!.time });
  }
  return pivots;
}

/** Find pivot lows where low[i] < low[i±lookback] */
function pivotLows(candles: Candle[], lookback = 2): Pivot[] {
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
    if (isPivot) pivots.push({ index: i, value: l, time: candles[i]!.time });
  }
  return pivots;
}

function detectStructure(weeklyCandles: Candle[]): MarketStructure {
  // Use last 40 weekly candles for pivot detection (roughly 10 months)
  const window = weeklyCandles.slice(-40);
  const highs = pivotHighs(window);
  const lows = pivotLows(window);

  if (highs.length < 2 || lows.length < 2) return "UNKNOWN";

  const lastHigh = highs.at(-1)!;
  const prevHigh = highs.at(-2)!;
  const lastLow = lows.at(-1)!;
  const prevLow = lows.at(-2)!;

  const hh = lastHigh.value > prevHigh.value;
  const hl = lastLow.value > prevLow.value;

  if (hh && hl)  return "HH_HL";
  if (!hh && !hl) return "LH_LL";
  if (hh && !hl)  return "HH_LL";
  return "LH_HL";
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

// ─── Event detection ─────────────────────────────────────────────────────────

function detectEvents(
  snapshot: HtfSnapshot,
  price: number,
  sma200: number,
  rsi: RsiContext,
  cross: { current: MaCrossType; recent: MaCrossType },
  structure: MarketStructure,
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
    const daily = snapshot.h4Candles;
    if (daily.length >= 2) {
      const prevClose = daily.at(-2)!.close;
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
  if (prevState && prevState.lastStructure !== structure && structure !== "UNKNOWN") {
    if (structure === "HH_HL") {
      events.push({ type: "structure_shift_bullish", detail: `Structure shifted to ${structure}`, at });
    } else if (structure === "LH_LL") {
      events.push({ type: "structure_shift_bearish", detail: `Structure shifted to ${structure}`, at });
    }
  }

  return events;
}

// ─── State machine ────────────────────────────────────────────────────────────

function determineRegime(
  price: number,
  sma50: number,
  sma200: number,
  dailyRsi: number,
  structure: MarketStructure
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

  // CVD — last 50 4h candles (~8 days)
  const cvdData: CvdContext = {
    futures: cvd(snapshot.futuresH4Candles, 50),
    spot:    cvd(h4, 50),
  };

  // Anchored VWAPs — weekly (Monday 00:00 UTC) and monthly (1st 00:00 UTC)
  const now = new Date(snapshot.timestamp);
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const vwapData: VwapContext = {
    weekly:  anchoredVwap(h4, weekStart.getTime()),
    monthly: anchoredVwap(h4, monthStart.getTime()),
  };

  // Structure from daily candles — cleaner pivots than 4h
  const structure = detectStructure(daily);
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

  const regime = determineRegime(price, sma50, sma200, rsiDaily, structure);

  const since = prevState?.regime === regime ? prevState.since : snapshot.timestamp;
  const durationDays = Math.max(
    0,
    Math.round((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24))
  );
  const previousRegime =
    prevState?.regime !== regime
      ? (prevState?.regime ?? null)
      : (prevState?.previousRegime ?? null);

  const events = detectEvents(snapshot, price, sma200, rsi, cross, structure, prevState);

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
