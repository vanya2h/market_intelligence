// Database
export type { $Enums, Prisma } from "./generated/prisma/client.js";
export { prisma } from "./storage/db.js";

// Cache
export { getCached } from "./storage/cache.js";

// Prisma-generated types (models only as types)
export type {
  Asset,
  Brief,
  DerivativesDimension,
  Dimension,
  DimensionSnapshot,
  DimensionState,
  EtfsDimension,
  ExchangeFlowsDimension,
  HtfDimension,
  SentimentDimension,
  TradeIdea,
  TradeIdeaLevel,
  TradeIdeaReturn,
} from "./generated/prisma/client.js";

// Prisma enums (exported as values + types)
export {
  LevelType,
  PositioningRegime,
  EtfRegime as PrismaEtfRegime,
  ExchangeFlowsRegime as PrismaExchangeFlowsRegime,
  HtfRegime as PrismaHtfRegime,
  MarketStructure as PrismaMarketStructure,
  OiSignal as PrismaOiSignal,
  SentimentRegime as PrismaSentimentRegime,
  StressLevel,
  TradeDirection,
  TradeOutcome,
} from "./generated/prisma/client.js";

// Shared asset type
export type { AssetType } from "./types.js";

// Derivatives
export type {
  AnalysisSignals,
  Classified,
  DerivativesContext,
  DerivativesEventType,
  DerivativesState,
  MetricContext,
  OiSignal,
  PositioningState,
  StressState,
} from "./types.js";

// ETFs
export type { EtfContext, EtfEventType, EtfFlowMetrics, EtfRegime } from "./etfs/types.js";

// HTF
export type {
  DivergenceConfluence,
  HtfContext,
  HtfEventType,
  HtfRegime,
  MaContext,
  MarketStructure,
  MfiContext,
  RsiContext,
} from "./htf/types.js";

// Sentiment
export type {
  FearGreedComponents,
  SentimentContext,
  SentimentEventType,
  SentimentMetrics,
  SentimentRegime,
} from "./sentiment/types.js";

// Exchange Flows
export type {
  ExchangeFlowsContext,
  ExchangeFlowsEventType,
  ExchangeFlowsMetrics,
  ExchangeFlowsRegime,
} from "./exchange_flows/types.js";

// Orchestrator
export type {
  BarChartBlock,
  CalloutBlock,
  DividerBlock,
  HeadingBlock,
  HeatmapBlock,
  LevelMapBlock,
  MetricRowBlock,
  RegimeBannerBlock,
  RichBlock,
  RichBrief,
  ScorecardBlock,
  SignalBlock,
  SpacerBlock,
  SpectrumBlock,
  TensionBlock,
  TextBlock,
} from "./orchestrator/rich-synthesizer.js";
export type { AssetBrief, DimensionOutput } from "./orchestrator/types.js";
