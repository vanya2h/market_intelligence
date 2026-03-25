// ─── Derivatives Structure (Dimension 01) ───────────────────────────────────

export type DerivativesRegime =
  | "NEUTRAL"
  | "HEATING_UP"
  | "CROWDED_LONG"
  | "CROWDED_SHORT"
  | "UNWINDING"
  | "SHORT_SQUEEZE"
  | "CAPITULATION"
  | "DELEVERAGING";

// Raw data as returned by the collector (mirrors CoinGlass response shape)
export interface DerivativesSnapshot {
  timestamp: string; // ISO 8601
  asset: "BTC" | "ETH";
  funding: {
    current: number; // e.g. 0.045 (%)
    history1m: TimestampedValue[]; // hourly for last 30 days
  };
  openInterest: {
    current: number; // USD
    history1m: TimestampedValue[];
  };
  longShortRatio: {
    current: number; // e.g. 2.1
  };
  liquidations: {
    current8h: number; // USD
    bias: string; // e.g. "75% long"
    history1m: TimestampedValue[]; // 8h aggregates for last 30 days
  };
}

export interface TimestampedValue {
  timestamp: string;
  value: number;
}

// Multi-timeframe context for a single metric
export interface MetricContext {
  current: number;
  highs: TimeframeMap;
  lows: TimeframeMap;
  percentile: PercentileMap;
}

export interface TimeframeMap {
  "1w": number;
  "1m": number;
  "3m"?: number;
  "6m"?: number;
  "1y"?: number;
}

export interface PercentileMap {
  "1m": number;
  "3m"?: number;
  "1y"?: number;
}

export interface LiquidationContext {
  current8h: number;
  bias: string;
  highs: TimeframeMap;
  percentile: PercentileMap;
}

export interface RegimeEvent {
  type: "oi_spike" | "oi_drop" | "funding_flip" | "liq_spike" | "ls_extreme";
  detail: string;
  at: string; // ISO timestamp
}

// OI level modifier — complements the regime label when positioning is extreme
// even without clear directional crowding (e.g. NEUTRAL + ELEVATED_OI)
export type OiSignal = "EXTREME" | "ELEVATED" | "NORMAL" | "DEPRESSED";

// Structured context object passed to the LLM agent
export interface DerivativesContext {
  asset: "BTC" | "ETH";
  regime: DerivativesRegime;
  oiSignal: OiSignal;
  since: string;
  durationHours: number;
  previousRegime: DerivativesRegime | null;
  funding: MetricContext;
  openInterest: MetricContext;
  liquidations: LiquidationContext;
  longShortRatio: MetricContext;
  events: RegimeEvent[];
}

// Persisted state (written to data/state.json)
export interface DerivativesState {
  asset: "BTC" | "ETH";
  regime: DerivativesRegime;
  since: string;
  previousRegime: DerivativesRegime | null;
  lastUpdated: string;
}
