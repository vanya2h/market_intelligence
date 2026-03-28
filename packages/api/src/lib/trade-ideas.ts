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

export interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  sentiment: number;
  total: number;
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
