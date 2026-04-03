// ─── Market Sentiment (Dimension 06) ──────────────────────────────────────────

import type { SentimentRegime as PrismaSentimentRegime } from "../generated/prisma/client.js";

export type SentimentRegime = PrismaSentimentRegime;

// ─── Collector types ─────────────────────────────────────────────────────────

export interface UnbiasConsensusEntry {
  date: string;                  // YYYY-MM-DD
  consensusIndex: number;        // -100 to +100
  consensusIndex30dMa: number;
  zScore: number;                // 90-day rolling z-score
  avgSentimentScore: number;
  bullishAnalysts: number;
  bearishAnalysts: number;
  totalAnalysts: number;
  bullishOpinions: number;
  bearishOpinions: number;
  totalOpinions: number;
}

export interface SentimentSnapshot {
  timestamp: string;
  asset: "BTC" | "ETH";
  consensus: UnbiasConsensusEntry[];   // latest 7 days (free tier)
  crossDimensions: CrossDimensionInputs;
}

// ─── Cross-dimension inputs for composite F&G ───────────────────────────────

/** Subset of data from other dimensions needed to compute composite F&G */
export interface CrossDimensionInputs {
  derivatives: {
    fundingPercentile1m: number;   // 0–100
    oiPercentile1m: number;        // 0–100
    cbPremiumPercentile1m: number; // 0–100
    liqPercentile1m: number;       // 0–100
    liqLongPct: number;            // 0–100, % of liquidations that are longs
    regime: string;
  } | null;
  etfs: {
    consecutiveInflowDays: number;
    consecutiveOutflowDays: number;
    todaySigma: number;            // σ from 30d mean
    regime: string;
  } | null;
  htf: {
    priceVsSma50Pct: number;       // % above/below
    priceVsSma200Pct: number;
    dailyRsi: number;
    h4Rsi: number;                 // 4h RSI for momentum divergence detection
    structure: string;             // HH_HL, LH_LL, etc.
    regime: string;
    atr: number;                   // ATR-14 on 4h — execution-timeframe volatility
    atrRatio: number;              // current ATR / 30d-mean ATR — compression detection
    cvdDivergence: string;         // futures CVD divergence: BULLISH, BEARISH, NONE
  } | null;
  exchangeFlows: {
    reserveChange7dPct: number;    // negative = outflow = bullish
    reserveChange30dPct: number;
    balanceTrend: string;          // "RISING" | "FALLING" | "FLAT"
    todaySigma: number;
    isAt30dLow: boolean;
    isAt30dHigh: boolean;
    regime: string;
  } | null;
}

// ─── Analyzer types ──────────────────────────────────────────────────────────

/** Individual component scores (0–100 each) for the composite F&G */
export interface FearGreedComponents {
  positioning: number;        // from derivatives: funding, L/S, OI
  trend: number;              // from HTF: price vs SMAs, RSI, structure
  institutionalFlows: number; // from ETFs: flow streaks, magnitude
  exchangeFlows: number;      // from exchange flows: on-chain supply pressure
  expertConsensus: number;    // from unbias: consensus index, z-score
}

export interface SentimentMetrics {
  // Composite Fear & Greed (our own, 0–100)
  compositeIndex: number;
  compositeLabel: string;          // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
  components: FearGreedComponents;

  // unbias consensus
  consensusIndex: number;           // latest, -100 to +100
  consensusIndex30dMa: number;
  zScore: number;
  bullishRatio: number;             // bullish / total analysts (0–1)
  totalAnalysts: number;
  consensusDelta7d: number;         // week-over-week change in consensus index (absolute points)

  // Divergence
  divergence: boolean;              // experts and crowd disagree
  divergenceType: "experts_bullish_crowd_fearful"
    | "experts_bearish_crowd_greedy"
    | null;
}

export interface SentimentEvent {
  type:
    | "extreme_fear"
    | "extreme_greed"
    | "consensus_bullish"
    | "consensus_bearish"
    | "consensus_deteriorating"
    | "consensus_deteriorating_severe"
    | "sentiment_divergence";
  detail: string;
  at: string;
}

export interface SentimentContext {
  asset: "BTC" | "ETH";
  regime: SentimentRegime;
  since: string;
  durationDays: number;
  previousRegime: SentimentRegime | null;
  metrics: SentimentMetrics;
  events: SentimentEvent[];
}

// ─── Persisted state ─────────────────────────────────────────────────────────

export interface SentimentState {
  asset: "BTC" | "ETH";
  regime: SentimentRegime;
  since: string;
  previousRegime: SentimentRegime | null;
  lastUpdated: string;
}
