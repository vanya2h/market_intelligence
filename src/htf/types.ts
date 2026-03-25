// ─── HTF Technical Structure (Dimension 07) ──────────────────────────────────

export type HtfRegime =
  | "MACRO_BULLISH"   // price > 200 DMA, bullish structure (HH/HL)
  | "BULL_EXTENDED"   // macro bullish + weekly RSI > 70 (overbought risk)
  | "MACRO_BEARISH"   // price < 200 DMA, bearish structure (LH/LL)
  | "BEAR_EXTENDED"   // macro bearish + weekly RSI < 30 (capitulation zone)
  | "RECLAIMING"      // price between 50 DMA and 200 DMA, recovering
  | "RANGING";        // mixed signals, no directional bias

export type MarketStructure =
  | "HH_HL"   // bullish: higher high + higher low
  | "LH_LL"   // bearish: lower high + lower low
  | "HH_LL"   // mixed: expanding / volatile
  | "LH_HL"   // mixed: contracting / coiling
  | "UNKNOWN";

export type MaCrossType = "GOLDEN" | "DEATH" | "NONE";

export interface Candle {
  time: number;   // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Raw data from collector
export interface HtfSnapshot {
  timestamp: string;      // ISO 8601
  asset: "BTC" | "ETH";
  h4Candles:    Candle[]; // last ~300 4h candles → SMA 50/200 on 4h, 4h RSI
  dailyCandles: Candle[]; // last ~104 daily candles → daily RSI, market structure
}

export interface MaContext {
  sma50: number;
  sma200: number;
  priceVsSma50Pct: number;   // % above/below (negative = below)
  priceVsSma200Pct: number;
  crossType: MaCrossType;    // current relationship
  recentCross: MaCrossType;  // if a cross happened within last 10 4h candles
}

export interface RsiContext {
  daily: number; // RSI-14 on daily closes — trend bias
  h4: number;    // RSI-14 on 4h closes — momentum / entry context
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
    | "structure_shift_bearish";
  detail: string;
  at: string;
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
  structure: MarketStructure;
  events: HtfEvent[];
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
