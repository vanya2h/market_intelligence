// Database
export { prisma } from "./storage/db.js";
export type { Prisma, $Enums } from "./generated/prisma/client.js";

// Cache
export { getCached } from "./storage/cache.js";

// Prisma-generated types (models only as types)
export type {
  Asset,
  Dimension,
  Brief,
  DerivativesDimension,
  EtfsDimension,
  HtfDimension,
  SentimentDimension,
  DimensionState,
  DimensionSnapshot,
  TradeIdea,
  TradeIdeaLevel,
  TradeIdeaReturn,
} from "./generated/prisma/client.js";

// Prisma enums (exported as values + types)
export {
  PositioningRegime,
  StressLevel,
  OiSignal as PrismaOiSignal,
  EtfRegime as PrismaEtfRegime,
  HtfRegime as PrismaHtfRegime,
  MarketStructure as PrismaMarketStructure,
  SentimentRegime as PrismaSentimentRegime,
  TradeDirection,
  TradeOutcome,
  LevelType,
} from "./generated/prisma/client.js";

// Derivatives
export type {
  DerivativesContext,
  DerivativesState,
  PositioningState,
  StressState,
  AnalysisSignals,
  Classified,
  MetricContext,
  OiSignal,
} from "./types.js";

// ETFs
export type { EtfContext, EtfRegime, EtfFlowMetrics } from "./etfs/types.js";

// HTF
export type { HtfContext, HtfRegime, MarketStructure, MaContext, RsiContext } from "./htf/types.js";

// Sentiment
export type { SentimentContext, SentimentRegime, SentimentMetrics, FearGreedComponents } from "./sentiment/types.js";

// Orchestrator
export type { DimensionOutput, AssetBrief } from "./orchestrator/types.js";
export type {
  RichBlock,
  RichBrief,
  HeadingBlock,
  TextBlock,
  DividerBlock,
  SpacerBlock,
  SpectrumBlock,
  MetricRowBlock,
  BarChartBlock,
  HeatmapBlock,
  ScorecardBlock,
  CalloutBlock,
  SignalBlock,
  LevelMapBlock,
  RegimeBannerBlock,
  TensionBlock,
} from "./orchestrator/rich-synthesizer.js";
