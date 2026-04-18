// ─── Orchestrator Types ───────────────────────────────────────────────────────

import type { EtfContext } from "../etfs/types.js";
import type { ExchangeFlowsContext } from "../exchange_flows/types.js";
import type {
  EtfRegime,
  ExchangeFlowsRegime,
  HtfRegime,
  MarketStructure,
  OiSignal,
  PositioningRegime,
  SentimentRegime,
  StressLevel,
} from "../generated/prisma/client.js";
import type { HtfContext } from "../htf/types.js";
import type { SentimentContext } from "../sentiment/types.js";
import type { AssetType, DerivativesContext } from "../types.js";

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
  exchangeFlows: number | null;
  expertConsensus: number | null;
  context: SentimentContext;
  interpretation: string;
}

/** Output from the exchange flows dimension pipeline */
export interface ExchangeFlowsOutput {
  dimension: "EXCHANGE_FLOWS";
  regime: ExchangeFlowsRegime;
  previousRegime: ExchangeFlowsRegime | null;
  since: string;
  context: ExchangeFlowsContext;
  interpretation: string;
}

/** Discriminated union of all dimension outputs */
export type DimensionOutput = DerivativesOutput | EtfsOutput | HtfOutput | SentimentOutput | ExchangeFlowsOutput;

/** Human-readable labels for each dimension */
export const DIMENSION_LABELS: Record<DimensionOutput["dimension"], string> = {
  DERIVATIVES: "Derivatives Structure",
  ETFS: "Institutional Flows (ETFs)",
  HTF: "HTF Technical Structure",
  SENTIMENT: "Market Sentiment (Composite F&G)",
  EXCHANGE_FLOWS: "Exchange Flows & Liquidity",
};

/** Full pipeline output for one asset */
export interface AssetBrief {
  asset: AssetType;
  timestamp: string;
  dimensions: DimensionOutput[];
  brief: string; // synthesized by orchestrator LLM
}
