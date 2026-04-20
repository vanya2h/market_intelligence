// ─── ETF Flows (Dimension 03) ─────────────────────────────────────────────────

import type { EtfRegime as PrismaEtfRegime } from "../generated/prisma/client.js";
import type { AssetType } from "../types.js";

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
  asset: AssetType;
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

export interface EtfDataFreshness {
  /** 0.1 (stale Monday) → 1.0 (fresh weekday after release) */
  weight: number;
  /** Sigma threshold for event detection: 2.0 (fresh) → 2.5 (stale) */
  sigmaThreshold: number;
  /** Human-readable staleness note for the LLM agent, undefined when fresh */
  note?: string;
}

// Structured context passed to the LLM agent
export interface EtfContext {
  asset: AssetType;
  regime: EtfRegime;
  since: string;
  durationDays: number;
  previousRegime: EtfRegime | null;
  flow: EtfFlowMetrics;
  totalAumUsd: number;
  gbtcPremiumRate?: number;
  events: EtfEvent[];
  dataFreshness: EtfDataFreshness;
}

// Persisted state
export interface EtfState {
  asset: AssetType;
  regime: EtfRegime;
  since: string;
  previousRegime: EtfRegime | null;
  lastUpdated: string;
}
