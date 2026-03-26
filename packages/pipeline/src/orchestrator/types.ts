// ─── Orchestrator Types ───────────────────────────────────────────────────────

import type { PositioningRegime, StressLevel, OiSignal, EtfRegime, HtfRegime, MarketStructure, SentimentRegime } from "../generated/prisma/client.js";
import type { DerivativesContext } from "../types.js";
import type { EtfContext } from "../etfs/types.js";
import type { SentimentContext } from "../sentiment/types.js";
import type { HtfContext } from "../htf/types.js";

/** Output from the derivatives dimension pipeline */
export interface DerivativesOutput {
  dimension: "DERIVATIVES";
  regime: PositioningRegime;
  stress: StressLevel | null;
  previousRegime: PositioningRegime | null;
  previousStress: StressLevel | null;
  oiSignal: OiSignal;
  since: string;
  context: DerivativesContext;
  interpretation: string;
}

/** Output from the ETF flows dimension pipeline */
export interface EtfsOutput {
  dimension: "ETFS";
  regime: EtfRegime;
  previousRegime: EtfRegime | null;
  since: string;
  context: EtfContext;
  interpretation: string;
}

/** Output from the HTF technical dimension pipeline */
export interface HtfOutput {
  dimension: "HTF";
  regime: HtfRegime;
  previousRegime: HtfRegime | null;
  since: string;
  lastStructure: MarketStructure | null;
  snapshotPrice: number | null;
  context: HtfContext;
  interpretation: string;
}

/** Output from the sentiment dimension pipeline */
export interface SentimentOutput {
  dimension: "SENTIMENT";
  regime: SentimentRegime;
  previousRegime: SentimentRegime | null;
  since: string;
  compositeIndex: number | null;
  compositeLabel: string | null;
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
  context: SentimentContext;
  interpretation: string;
}

/** Discriminated union of all dimension outputs */
export type DimensionOutput = DerivativesOutput | EtfsOutput | HtfOutput | SentimentOutput;

/** Human-readable labels for each dimension */
export const DIMENSION_LABELS: Record<DimensionOutput["dimension"], string> = {
  DERIVATIVES: "Derivatives Structure",
  ETFS: "Institutional Flows (ETFs)",
  HTF: "HTF Technical Structure",
  SENTIMENT: "Market Sentiment (Composite F&G)",
};

/** Full pipeline output for one asset */
export interface AssetBrief {
  asset: "BTC" | "ETH";
  timestamp: string;
  dimensions: DimensionOutput[];
  brief: string; // synthesized by orchestrator LLM
}
