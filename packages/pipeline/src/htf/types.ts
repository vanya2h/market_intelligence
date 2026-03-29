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
  futuresH4Candles: Candle[]; // last ~750 4h candles from futures → CVD + volume profile
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

/**
 * Mechanism behind a CVD divergence signal.
 *
 * ABSORPTION: CVD makes new extreme but price does not.
 *   Aggressive buying/selling exists but is being absorbed by the opposing side.
 *   Strong signal — heavy hands are active.
 *
 * EXHAUSTION: Price makes new extreme but CVD does not.
 *   Price moves on thin liquidity or short/long covering, not real aggression.
 *   Trend running out of fuel.
 */
export type CvdDivergenceMechanism = "ABSORPTION" | "EXHAUSTION" | "NONE";

/**
 * Spot vs futures CVD divergence — distinguishes real demand from leveraged noise.
 *
 * CONFIRMED_BUYING:  both rising  → genuine buy-side pressure
 * CONFIRMED_SELLING: both falling → genuine sell-side pressure
 * SUSPECT_BOUNCE:    futures rising + spot flat/falling
 *                    → price bounce driven by short covering, not real demand
 * SPOT_LEADS:        spot rising  + futures flat/falling
 *                    → organic spot accumulation without leverage
 * NONE:              no clear alignment or divergence
 */
export type SpotFuturesCvdDivergence =
  | "CONFIRMED_BUYING"
  | "CONFIRMED_SELLING"
  | "SUSPECT_BOUNCE"
  | "SPOT_LEADS"
  | "NONE";

export interface CvdWindow {
  regime: CvdRegime; // trend direction based on linear regression
  slope: number; // normalized slope (delta per candle / avg volume)
  r2: number; // R² of the linear fit — confidence in the trend
}

export interface CvdSeries {
  value: number; // cumulative volume delta (long window)
  short: CvdWindow; // 20 candles (~3.3d) — catches turns early
  long: CvdWindow; // 75 candles (~12.5d) — confirmed swing trend
  divergence: CvdDivergence; // price vs CVD swing-point disagreement
  divergenceMechanism: CvdDivergenceMechanism; // absorption or exhaustion
}

export interface CvdContext {
  futures: CvdSeries; // CVD analysis on futures 4h
  spot: CvdSeries; // CVD analysis on spot 4h
  /** Whether futures and spot CVD agree — detects short-covering bounces */
  spotFuturesDivergence: SpotFuturesCvdDivergence;
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
    | "cvd_divergence_bearish"
    | "cvd_suspect_bounce";
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

/**
 * Volatility compression context — detects "coiled spring" setups.
 *
 * After a big move, volatility decays (ATR drops). When ATR is compressed
 * relative to its recent history AND a prior displacement exists, the market
 * is coiling for the next big move.
 */
export interface VolatilityContext {
  /** Current ATR-14 on 4h candles */
  atr: number;
  /** ATR percentile rank within last 50 4h candles (0–100). Low = compressed. */
  atrPercentile: number;
  /** ATR ratio: current ATR / mean ATR over last 50 candles. < 0.7 = compressed. */
  atrRatio: number;
  /** Max absolute price displacement (ATR-normalized) in last 30 candles. High = recent big move. */
  recentDisplacement: number;
  /** True when compression detected after a big move (coiled spring). */
  compressionAfterMove: boolean;
}

export type VolumeProfilePosition = "ABOVE_VA" | "INSIDE_VA" | "BELOW_VA";

export interface VolumeProfileResult {
  /** Point of Control — price level with highest volume */
  poc: number;
  /** % of total volume concentrated at POC bin (thickness = confidence) */
  pocVolumePct: number;
  /** Value Area high boundary (70% of volume rule) */
  vaHigh: number;
  /** Value Area low boundary */
  vaLow: number;
  /** Current price position relative to Value Area */
  pricePosition: VolumeProfilePosition;
  /** % distance from POC (negative = below) */
  priceVsPocPct: number;
  /** Up to 3 High Volume Nodes excluding POC (secondary magnets) */
  hvns: number[];
  /** Up to 3 Low Volume Nodes — acceleration zones between HVNs */
  lvns: number[];
}

export interface VolumeProfileContext {
  /** Displacement-anchored profile — covers the current range */
  profile: VolumeProfileResult;
  /** How many candles back the detected range started (transparency for LLM) */
  rangeStartCandles: number;
}

export type SweepLevelType = "HIGH" | "LOW";
export type SweepPeriod = "WEEKLY" | "MONTHLY";

export interface SweepLevel {
  /** The high or low price */
  price: number;
  /** HIGH = unswept high, LOW = unswept low */
  type: SweepLevelType;
  /** Calendar period this level belongs to */
  period: SweepPeriod;
  /** Days since the candle that formed this level */
  ageDays: number;
  /** % distance from current price (always positive) */
  distancePct: number;
  /** Sweep attraction score: distancePct × log2(ageDays) — higher = more likely to be swept */
  attraction: number;
}

export interface SweepContext {
  /** All sweep levels, sorted by attraction descending */
  levels: SweepLevel[];
  /** Highest-attraction level above current price (sweep target for longs) */
  nearestHigh: SweepLevel | null;
  /** Highest-attraction level below current price (sweep target for shorts) */
  nearestLow: SweepLevel | null;
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
  /** Volatility compression / coiled spring detection */
  volatility: VolatilityContext;
  /** Volume profile with displacement-anchored range detection */
  volumeProfile: VolumeProfileContext;
  /** Liquidity sweep levels — stale weekly/monthly highs and lows that attract price */
  sweep: SweepContext;
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
