// ─── HTF Technical Structure (Dimension 07) ──────────────────────────────────

import type {
  HtfRegime as PrismaHtfRegime,
  MarketStructure as PrismaMarketStructure,
} from "../generated/prisma/client.js";

export type HtfRegime = PrismaHtfRegime;
export type MarketStructure = PrismaMarketStructure;

export type MaCrossType = "GOLDEN" | "DEATH" | "NONE";

export interface Candle {
  time: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number; // taker buy base-asset volume (for CVD)
}

// Raw data from collector
export interface HtfSnapshot {
  timestamp: string; // ISO 8601
  asset: "BTC" | "ETH";
  h4Candles: Candle[]; // last ~300 4h candles → SMA 50/200 on 4h, 4h RSI
  dailyCandles: Candle[]; // last ~104 daily candles → daily RSI, market structure
  futuresH4Candles: Candle[]; // last ~300 4h candles from futures → futures CVD
}

export interface MaContext {
  sma50: number;
  sma200: number;
  priceVsSma50Pct: number; // % above/below (negative = below)
  priceVsSma200Pct: number;
  crossType: MaCrossType; // current relationship
  recentCross: MaCrossType; // if a cross happened within last 10 4h candles
}

export interface RsiContext {
  daily: number; // RSI-14 on daily closes — trend bias
  h4: number; // RSI-14 on 4h closes — momentum / entry context
}

export type CvdRegime = "RISING" | "DECLINING" | "FLAT";
export type CvdDivergence = "BULLISH" | "BEARISH" | "NONE";

export interface CvdWindow {
  regime: CvdRegime; // trend direction based on linear regression
  slope: number; // normalized slope (delta per candle / avg volume)
  r2: number; // R² of the linear fit — confidence in the trend
}

export interface CvdSeries {
  value: number; // cumulative volume delta (long window)
  short: CvdWindow; // 20 candles (~3.3d) — catches turns early
  long: CvdWindow; // 75 candles (~12.5d) — confirmed swing trend
  divergence: CvdDivergence; // price vs CVD trend disagreement
}

export interface CvdContext {
  futures: CvdSeries; // CVD analysis on futures 4h
  spot: CvdSeries; // CVD analysis on spot 4h
}

export interface VwapContext {
  weekly: number; // volume-weighted average price for current week
  monthly: number; // volume-weighted average price for current month
}

export interface HtfEvent {
  type:
    | "golden_cross"
    | "death_cross"
    | "dma200_reclaim"
    | "dma200_break"
    | "rsi_daily_overbought"
    | "rsi_daily_oversold"
    | "structure_shift_bullish"
    | "structure_shift_bearish"
    | "cvd_divergence_bullish"
    | "cvd_divergence_bearish";
  detail: string;
  at: string;
}

/**
 * Signal staleness — how many 4h candles ago each key signal was strongest.
 * Helps the LLM judge whether an entry is timely or fading.
 * null = signal not present in current window.
 */
export interface SignalStaleness {
  /** Candles since RSI-14 was most overbought/oversold in the short window */
  rsiExtreme: number | null;
  /** Candles since CVD divergence R² peaked (strongest conviction) */
  cvdDivergencePeak: number | null;
  /** Candles since the most recent pivot completed */
  lastPivot: number | null;
}

// Structured context passed to the LLM agent
export interface HtfContext {
  asset: "BTC" | "ETH";
  regime: HtfRegime;
  since: string;
  durationDays: number;
  previousRegime: HtfRegime | null;
  price: number;
  ma: MaContext;
  rsi: RsiContext;
  cvd: CvdContext;
  vwap: VwapContext;
  structure: MarketStructure;
  events: HtfEvent[];
  /** ATR-14 on 4h candles — execution-timeframe volatility context */
  atr: number;
  /** How fresh each key signal is (candles since peak) — null if not present */
  staleness: SignalStaleness;
}

// Persisted state
export interface HtfState {
  asset: "BTC" | "ETH";
  regime: HtfRegime;
  since: string;
  previousRegime: HtfRegime | null;
  lastUpdated: string;
  lastStructure: MarketStructure;
}
