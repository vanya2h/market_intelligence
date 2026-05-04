/**
 * Trade Ideas — Data Layer
 *
 * Prisma include pattern and aggregate stats for trade idea queries.
 */

import type { Confluence, Prisma } from "@market-intel/pipeline";
import { parseStoredConfluence } from "@market-intel/pipeline/shared";
import type { Jsonify } from "../common/json.js";
import type { AssetType } from "./asset.js";

export type { Confluence };

export const tradeIdeaInclude = {
  levels: {
    orderBy: { label: "asc" as const },
  },
  returns: {
    orderBy: { hoursAfter: "asc" as const },
  },
} satisfies Prisma.TradeIdeaInclude;

export type TradeIdeaRaw = Prisma.TradeIdeaGetPayload<{
  include: typeof tradeIdeaInclude;
}>;

// ─── Frontend types ──────────────────────────────────────────────────────────

export type TradeDirection = "LONG" | "SHORT" | "FLAT";
export type TradeOutcome = "OPEN" | "WIN" | "LOSS";
export type LevelType = "INVALIDATION" | "TARGET";

export interface SizingInfo {
  positionSizePct: number;
  convictionMultiplier: number;
  dailyVolPct: number;
}

export interface AggregatorInfo {
  /** "ml" = ONNX model produced the total; "fallback" = equal-weight arithmetic average. */
  source: "ml" | "fallback";
  /** Model version (e.g. "v1") when source = "ml". */
  modelVersion?: string;
  /** P(win) in [0,1] from the ML model when source = "ml". */
  pWin?: number;
}

export interface TradeIdeaLevel {
  type: LevelType;
  label: string;
  price: number;
  outcome: TradeOutcome;
  qualityScore: number | null;
  resolvedAt: Date | null;
}

export interface TradeIdeaReturn {
  hoursAfter: number;
  price: number;
  returnPct: number;
  qualityAtPoint: number;
}

export interface TradeIdea {
  id: string;
  briefId: string;
  asset: AssetType;
  direction: TradeDirection;
  entryPrice: number;
  compositeTarget: number;
  /** Per-dimension scores — keys are DimensionEnum values. */
  confluence: Confluence | null;
  /** ML aggregator total, or equal-weight fallback. Null for legacy rows without stored total. */
  confluenceTotal: number | null;
  /** Position sizing metadata parsed from the stored JSON blob. */
  sizing: SizingInfo | null;
  /** ML aggregator metadata parsed from the stored JSON blob. */
  aggregator: AggregatorInfo | null;
  /** Recommended position size as % of account notional (5–150) */
  positionSizePct: number;
  skipped: boolean;
  createdAt: Date;
  levels: TradeIdeaLevel[];
  returns: TradeIdeaReturn[];
}

export function parseTradeIdea(raw: Jsonify<TradeIdeaRaw>): TradeIdea {
  const rawConf = raw.confluence as Record<string, unknown> | null;
  let confluence: Confluence | null = null;
  let confluenceTotal: number | null = null;
  let sizing: SizingInfo | null = null;
  let aggregator: AggregatorInfo | null = null;

  if (rawConf != null) {
    const parsed = parseStoredConfluence(rawConf);
    confluence = parsed.confluence;
    confluenceTotal = parsed.total;
    if (rawConf.sizing != null && typeof rawConf.sizing === "object") {
      sizing = rawConf.sizing as SizingInfo;
    }
    if (rawConf.aggregator != null && typeof rawConf.aggregator === "object") {
      aggregator = rawConf.aggregator as AggregatorInfo;
    }
  }

  return {
    id: raw.id,
    briefId: raw.briefId,
    asset: raw.asset as AssetType,
    direction: raw.direction as TradeDirection,
    entryPrice: raw.entryPrice,
    compositeTarget: raw.compositeTarget,
    confluence,
    confluenceTotal,
    sizing,
    aggregator,
    skipped: raw.skipped,
    positionSizePct: raw.positionSizePct,
    createdAt: new Date(raw.createdAt),
    levels: raw.levels.map((l) => ({
      type: l.type as LevelType,
      label: l.label,
      price: l.price,
      outcome: l.outcome as TradeOutcome,
      qualityScore: l.qualityScore,
      resolvedAt: l.resolvedAt ? new Date(l.resolvedAt) : null,
    })),
    returns: raw.returns.map((r) => ({
      hoursAfter: r.hoursAfter,
      price: r.price,
      returnPct: r.returnPct,
      qualityAtPoint: r.qualityAtPoint,
    })),
  };
}

export interface TradeIdeaLevelStats {
  type: string; // "INVALIDATION" | "TARGET"
  label: string; // "1:2", "T1", etc.
  total: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number | null;
  avgQuality: number | null;
}

export interface TradeIdeaStats {
  totalIdeas: number;
  levels: TradeIdeaLevelStats[];
}

// ─── Signal effectiveness ───────────────────────────────────────────────────

export interface SignalBucket {
  range: string;
  min: number;
  max: number;
  count: number;
  avgVelocity: number | null;
}

export interface DimensionEffectiveness {
  dimension: string;
  buckets: SignalBucket[];
  correlation: number | null;
  sampleSize: number;
}

export interface IdeaSummary {
  id: string;
  briefId: string;
  direction: string;
  positionSizePct: number;
  createdAt: string;
  peakVelocity: number | null;
  peakReturnPct: number | null;
  peakHoursAfter: number | null;
  peakQuality: number | null;
}

export interface SignalEffectiveness {
  dimensions: DimensionEffectiveness[];
  ideas: IdeaSummary[];
  totalIdeas: number;
  totalWithReturns: number;
}

// ─── Performance metrics ───────────────────────────────────────────────────

export interface MonthlyReturn {
  /** YYYY-MM */
  month: string;
  /** Size-weighted PnL: Σ(multiplier × peakReturn) */
  pnl: number;
  /** Number of ideas in the month */
  count: number;
  /** Average position size multiplier */
  avgSize: number;
  /** Win rate (peak return > 0) */
  winRate: number;
  /** Average peak return (unweighted) */
  avgReturn: number;
}

export interface PerformanceMetrics {
  /** Monthly returns series */
  months: MonthlyReturn[];
  /** Cumulative size-weighted PnL */
  totalPnl: number;
  /** Annualized Sharpe ratio from monthly returns (risk-free = 0) */
  sharpe: number | null;
  /** Total number of ideas */
  totalIdeas: number;
  /** Overall size-weighted average return per idea */
  avgPnlPerIdea: number;
  /** Overall win rate */
  winRate: number;
  /** Average position size multiplier */
  avgSize: number;
}

// ─── Strategy curves ───────────────────────────────────────────────────────

export interface StrategyPoint {
  /** ISO timestamp of exit (resolvedAt of whichever level triggered) */
  resolvedAt: string;
  /** Running cumulative % return for this strategy */
  cumulativeReturn: number;
  /** Per-idea contribution to return */
  ideaReturn: number;
  outcome: "WIN" | "LOSS";
}

export interface Strategy {
  /** Human-readable name, e.g. "Strategy 1" */
  name: string;
  /** Pairing label, e.g. "T1:S1" */
  label: string;
  points: StrategyPoint[];
  totalIdeas: number;
  wins: number;
  winRate: number | null;
  totalReturn: number;
}

export interface StrategyCurvesData {
  strategies: Strategy[];
}
