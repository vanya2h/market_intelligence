/**
 * Trade Ideas — Data Layer
 *
 * Prisma include pattern and aggregate stats for trade idea queries.
 */

import type { Prisma } from "@market-intel/pipeline";
import type { AssetType } from "./asset.js";
import type { Jsonify } from "../common/json.js";

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

export interface BiasFactor {
  dimension: string;
  score: number;
}

export interface DirectionalBias {
  lean: "LONG" | "SHORT" | "NEUTRAL";
  strength: number;
  topFactors: BiasFactor[];
}

export interface SizingInfo {
  positionSizePct: number;
  convictionMultiplier: number;
  dailyVolPct: number;
}

/**
 * Confluence values are in -1..+1 (per-dim are unweighted normalized scores;
 * total is the weighted average across dimensions). The UI renders them as
 * percentages.
 */
export interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
  bias?: DirectionalBias;
  sizing?: SizingInfo;
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
  confluence: Confluence | null;
  /** Recommended position size as % of account notional (5–150) */
  positionSizePct: number;
  skipped: boolean;
  createdAt: Date;
  levels: TradeIdeaLevel[];
  returns: TradeIdeaReturn[];
}

export function parseTradeIdea(raw: Jsonify<TradeIdeaRaw>): TradeIdea {
  return {
    id: raw.id,
    briefId: raw.briefId,
    asset: raw.asset as AssetType,
    direction: raw.direction as TradeDirection,
    entryPrice: raw.entryPrice,
    compositeTarget: raw.compositeTarget,
    confluence: raw.confluence as Confluence | null,
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
