// Database
export { prisma } from "./storage/db.js";

// Cache
export { getCached } from "./storage/cache.js";

// Prisma-generated types
export type {
  Asset,
  Dimension,
  Brief,
  BriefDimension,
  DimensionState,
  DimensionSnapshot,
} from "./generated/prisma/client.js";

// Derivatives
export type {
  DerivativesContext,
  DerivativesRegime,
  MetricContext,
  OiSignal,
} from "./types.js";

// ETFs
export type { EtfContext, EtfRegime, EtfFlowMetrics } from "./etfs/types.js";

// HTF
export type {
  HtfContext,
  HtfRegime,
  MarketStructure,
  MaContext,
  RsiContext,
} from "./htf/types.js";

// Sentiment
export type {
  SentimentContext,
  SentimentRegime,
  SentimentMetrics,
  FearGreedComponents,
} from "./sentiment/types.js";

// Orchestrator
export type { DimensionOutput, AssetBrief } from "./orchestrator/types.js";
export type { RichBlock, RichBrief } from "./orchestrator/rich-synthesizer.js";
