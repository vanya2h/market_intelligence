// ─── ETF Flows (Dimension 03) ─────────────────────────────────────────────────

export type EtfRegime =
  | "STRONG_INFLOW"
  | "STRONG_OUTFLOW"
  | "REVERSAL_TO_INFLOW"
  | "REVERSAL_TO_OUTFLOW"
  | "NEUTRAL"
  | "MIXED";

export interface EtfFlowDay {
  date: string;    // YYYY-MM-DD
  flowUsd: number; // positive = inflow, negative = outflow
  priceUsd: number;
  perEtf: { ticker: string; flowUsd: number }[];
}

// Raw data from collector
export interface EtfSnapshot {
  timestamp: string;      // ISO 8601
  asset: "BTC" | "ETH";
  flowHistory: EtfFlowDay[];
  totalAumUsd: number;
  gbtcPremiumRate?: number; // % (negative = discount); BTC only
  gbtcHoldingsBtc?: number; // BTC only
}

export interface EtfFlowMetrics {
  today: number;                  // USD, latest available day
  d3Sum: number;
  d7Sum: number;
  d30Sum: number;
  consecutiveOutflowDays: number;
  consecutiveInflowDays: number;
  mean30d: number;
  sigma30d: number;
  todaySigma: number;             // (today - mean) / sigma
  percentile1m: number;           // today vs 30d distribution
}

export interface EtfEvent {
  type: "sigma_inflow" | "sigma_outflow" | "gbtc_discount" | "gbtc_premium";
  detail: string;
  at: string;
}

// Structured context passed to the LLM agent
export interface EtfContext {
  asset: "BTC" | "ETH";
  regime: EtfRegime;
  since: string;
  durationDays: number;
  previousRegime: EtfRegime | null;
  flow: EtfFlowMetrics;
  totalAumUsd: number;
  gbtcPremiumRate?: number;
  events: EtfEvent[];
}

// Persisted state
export interface EtfState {
  asset: "BTC" | "ETH";
  regime: EtfRegime;
  since: string;
  previousRegime: EtfRegime | null;
  lastUpdated: string;
}
