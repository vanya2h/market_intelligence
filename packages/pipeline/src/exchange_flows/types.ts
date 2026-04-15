// ─── Exchange Flows & Liquidity (Dimension 04) ──────────────────────────────

import type { ExchangeFlowsRegime as PrismaExchangeFlowsRegime } from "../generated/prisma/client.js";
import type { AssetType } from "../types.js";

export type ExchangeFlowsRegime = PrismaExchangeFlowsRegime;

/** Single data point in the balance timeseries */
export interface BalancePoint {
  timestamp: number; // ms
  totalBalance: number; // asset units (BTC/ETH) across all exchanges
  priceUsd: number;
}

/** Per-exchange current balance snapshot */
export interface ExchangeBalance {
  exchange: string;
  balance: number; // asset units
  change1dPct: number;
  change7dPct: number;
  change30dPct: number;
}

// Raw data from collector
export interface ExchangeFlowsSnapshot {
  timestamp: string; // ISO 8601
  asset: AssetType;
  balanceHistory: BalancePoint[]; // sorted oldest → newest
  currentBalances: ExchangeBalance[];
  totalBalance: number; // current aggregate across all exchanges
  priceUsd: number; // current price
}

export interface ExchangeFlowsMetrics {
  totalBalance: number; // current total (asset units)
  totalBalanceUsd: number;

  // Net flow = balance change (positive = inflow, negative = outflow)
  netFlow1d: number; // asset units
  netFlow7d: number;
  netFlow30d: number;

  // Reserve change as percentage
  reserveChange1dPct: number;
  reserveChange7dPct: number;
  reserveChange30dPct: number;

  // Statistical context
  dailyFlowMean30d: number; // mean daily balance delta over 30d
  dailyFlowSigma30d: number; // σ of daily balance deltas
  todaySigma: number; // (today's delta - mean) / sigma
  flowPercentile1m: number; // today's delta vs 30d distribution (0–100)

  // Balance trend
  balanceTrend: "RISING" | "FALLING" | "FLAT";
  isAt30dLow: boolean;
  isAt30dHigh: boolean;

  // Top exchanges by balance
  topExchanges: { exchange: string; balance: number; changePct7d: number }[];
}

export type ExchangeFlowsEventType = "heavy_inflow" | "heavy_outflow" | "reserve_low" | "reserve_high";

export interface ExchangeFlowsEvent {
  type: ExchangeFlowsEventType;
  detail: string;
  at: string;
}

// Structured context passed to the LLM agent
export interface ExchangeFlowsContext {
  asset: AssetType;
  regime: ExchangeFlowsRegime;
  since: string;
  durationDays: number;
  previousRegime: ExchangeFlowsRegime | null;
  metrics: ExchangeFlowsMetrics;
  events: ExchangeFlowsEvent[];
}

// Persisted state
export interface ExchangeFlowsState {
  asset: AssetType;
  regime: ExchangeFlowsRegime;
  since: string;
  previousRegime: ExchangeFlowsRegime | null;
  lastUpdated: string;
}
