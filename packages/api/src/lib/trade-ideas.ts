/**
 * Trade Ideas — Data Layer
 *
 * Prisma include pattern and type definitions for trade idea queries.
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
} satisfies Prisma.TradeIdeaInclude;

export type TradeIdeaRaw = Prisma.TradeIdeaGetPayload<{
  include: typeof tradeIdeaInclude;
}>;

// ─── Frontend types ──────────────────────────────────────────────────────────

export type TradeDirection = "LONG" | "SHORT" | "FLAT";
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
    })),
  };
}
