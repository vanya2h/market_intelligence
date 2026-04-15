// ─── ETF Flows (Dimension 03) ─────────────────────────────────────────────────

import type { EtfRegime as PrismaEtfRegime } from "../generated/prisma/client.js";

export type EtfRegime = PrismaEtfRegime;

export interface EtfFlowDay {
  date: string; // YYYY-MM-DD
  flowUsd: number; // positive = inflow, negative = outflow
  priceUsd: number;
  perEtf: { ticker: string; flowUsd: number }[];
}

// Raw data from collector
export interface EtfSnapshot {
  timestamp: string; // ISO 8601
  asset: "BTC" | "ETH";
  flowHistory: EtfFlowDay[];
  totalAumUsd: number;
  gbtcPremiumRate?: number; // % (negative = discount); BTC only
  gbtcHoldingsBtc?: number; // BTC only
}

export interface EtfFlowMetrics {
  today: number; // USD, latest available day
  d3Sum: number;
  d7Sum: number;
  d30Sum: number;
  consecutiveOutflowDays: number;
  consecutiveInflowDays: number;
  mean30d: number;
  sigma30d: number;
  todaySigma: number; // (today - mean) / sigma
  percentile1m: number; // today vs 30d distribution
  /** Cumulative flow of the prior directional streak (before current reversal) */
  priorStreakFlow: number;
  /** Cumulative flow of the current reversal streak */
  reversalFlow: number;
  /** reversalFlow / |priorStreakFlow| — how much of the prior move has been reversed */
  reversalRatio: number;
}

export type EtfEventType = "sigma_inflow" | "sigma_outflow" | "gbtc_discount" | "gbtc_premium";

export interface EtfEvent {
  type: EtfEventType;
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
