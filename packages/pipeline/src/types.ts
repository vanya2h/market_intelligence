// ─── Derivatives Structure (Dimension 01) ───────────────────────────────────

import type { PositioningRegime, StressLevel, OiSignal as PrismaOiSignal, $Enums } from "./generated/prisma/client.js";

// Two independent dimensions (spec §1)

export type AssetType = $Enums.Asset;

/** Slow, structural dimension — who is crowded / trapped. */
export type PositioningState = PositioningRegime;

/** Fast, event-driven dimension — what is happening to that positioning now. */
export type StressState = StressLevel;

/** Classification result with traceability */
export interface Classified<T> {
  state: T;
  /** Human-readable signals that triggered the classification */
  triggers: string[];
}

/**
 * All computed metrics used by both classifiers.
 * These are the authoritative "explicit metrics" required by spec §2.
 */
export interface AnalysisSignals {
  fundingPct1m: number; // percentile rank vs 30d history
  liqPct1m: number; // percentile rank vs 30d history
  liqPct3m: number; // percentile rank vs 90d history
  oiChange24h: number; // fractional, e.g. -0.05 = −5%
  oiChange7d: number;
  oiZScore30d: number; // (current − mean30d) / std30d
  priceReturn24h: number | null; // null when price data unavailable
  priceReturn7d: number | null;
  fundingPressureCycles: number; // consecutive extreme-side funding cycles while OI elevated
  fundingPressureSide: "LONG" | "SHORT" | null; // which side is paying
}

// Raw data as returned by the collector (mirrors CoinGlass response shape)
export interface DerivativesSnapshot {
  timestamp: string; // ISO 8601
  asset: "BTC" | "ETH";
  funding: {
    current: number; // e.g. 0.045 (%)
    history1m: TimestampedValue[]; // 8h resolution for last 30 days
  };
  openInterest: {
    current: number; // USD
    history1m: TimestampedValue[]; // 4h resolution for last 30 days
  };
  liquidations: {
    current8h: number; // USD
    bias: string; // e.g. "75% long"
    history1m: TimestampedValue[]; // 8h resolution for last 90 days (270 pts)
  };
  coinbasePremium: {
    current: number; // premium_rate as % (e.g. 0.026 = 2.6bps above Binance)
    history1m: TimestampedValue[]; // 4h resolution for last 30 days
  };
  /** Futures close price history — null when endpoint unavailable */
  price: {
    history: TimestampedValue[]; // 4h resolution for last 30 days
  } | null;
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
  percentile: PercentileMap; // includes both "1m" and "3m"
}

export type DerivativesEventType = "oi_spike" | "oi_drop" | "funding_flip" | "liq_spike" | "ls_extreme";

export interface RegimeEvent {
  type: DerivativesEventType;
  detail: string;
  at: string; // ISO timestamp
}

// OI level modifier — complements classification when positioning is extreme
export type OiSignal = PrismaOiSignal;

// Structured context object passed to the LLM agent
export interface DerivativesContext {
  asset: $Enums.Asset;
  /** Slow structural dimension */
  positioning: Classified<PositioningState>;
  /** Fast event-driven dimension (evaluated with strict priority) */
  stress: Classified<StressState>;
  /** All computed metrics that drove classification — for traceability */
  signals: AnalysisSignals;
  oiSignal: OiSignal;
  since: string;
  durationHours: number;
  previousPositioning: PositioningState | null;
  previousStress: StressState | null;
  funding: MetricContext;
  openInterest: MetricContext;
  liquidations: LiquidationContext;
  coinbasePremium: MetricContext; // % rate; positive = US demand > offshore
  events: RegimeEvent[];
}

// Persisted state (written to DB)
export interface DerivativesState {
  asset: $Enums.Asset;
  positioning: PositioningState;
  /** null for pre-migration rows where stress was not yet tracked */
  stress: StressState | null;
  since: string;
  previousPositioning: PositioningState | null;
  previousStress: StressState | null;
  lastUpdated: string;
}
