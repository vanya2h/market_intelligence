/**
 * Trade Ideas — Data Layer
 *
 * Prisma include pattern and aggregate stats for trade idea queries.
 */

import { prisma } from "@market-intel/pipeline";
import type { Prisma } from "@market-intel/pipeline";

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

export interface TradeIdeaLevelStats {
  type: string;   // "INVALIDATION" | "TARGET"
  label: string;  // "1:2", "T1", etc.
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

export async function getTradeIdeaStats(
  asset: "BTC" | "ETH",
): Promise<TradeIdeaStats> {
  const totalIdeas = await prisma.tradeIdea.count({ where: { asset } });

  // Group level outcomes by type + label
  const levelGroups = await prisma.tradeIdeaLevel.groupBy({
    by: ["type", "label", "outcome"],
    where: { tradeIdea: { asset } },
    _count: true,
  });

  // Pivot into per-level stats
  const key = (type: string, label: string) => `${type}:${label}`;
  const statsMap = new Map<string, TradeIdeaLevelStats>();

  for (const row of levelGroups) {
    const k = key(row.type, row.label);
    let stats = statsMap.get(k);
    if (!stats) {
      stats = { type: row.type, label: row.label, total: 0, wins: 0, losses: 0, open: 0, winRate: null, avgQuality: null };
      statsMap.set(k, stats);
    }
    stats.total += row._count;
    if (row.outcome === "WIN") stats.wins = row._count;
    if (row.outcome === "LOSS") stats.losses = row._count;
    if (row.outcome === "OPEN") stats.open = row._count;
  }

  // Compute aggregate quality per type + label
  const qualityGroups = await prisma.tradeIdeaLevel.groupBy({
    by: ["type", "label"],
    where: { tradeIdea: { asset }, outcome: { not: "OPEN" } },
    _avg: { qualityScore: true },
  });

  for (const row of qualityGroups) {
    const stats = statsMap.get(key(row.type, row.label));
    if (stats) {
      stats.avgQuality = row._avg.qualityScore;
      const resolved = stats.wins + stats.losses;
      stats.winRate = resolved > 0 ? stats.wins / resolved : null;
    }
  }

  // Sort: invalidation levels first (by label), then target levels (by label)
  const levels = Array.from(statsMap.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "INVALIDATION" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return { totalIdeas, levels };
}

// ─── Confluence stats ────────────────────────────────────────────────────────

const DIMENSIONS = ["derivatives", "etfs", "htf", "sentiment"] as const;

interface ConfluenceDimensionStats {
  dimension: string;
  /** Stats when this dimension agreed (+1) with the direction */
  agreed: { count: number; wins: number; losses: number; winRate: number | null };
  /** Stats when this dimension disagreed (-1) */
  disagreed: { count: number; wins: number; losses: number; winRate: number | null };
  /** Stats when this dimension was neutral (0) */
  neutral: { count: number; wins: number; losses: number; winRate: number | null };
}

export interface ConfluenceStats {
  dimensions: ConfluenceDimensionStats[];
}

interface ConfluenceJson {
  derivatives?: number;
  etfs?: number;
  htf?: number;
  sentiment?: number;
}

/**
 * Computes per-dimension hit rates bucketed by agreement score.
 * Uses the T2 (full target) level as the benchmark for win/loss.
 */
export async function getConfluenceStats(
  asset: "BTC" | "ETH",
): Promise<ConfluenceStats> {
  // Fetch all ideas with resolved T2 levels, filter for confluence in-app
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset },
    include: {
      levels: {
        where: { label: "T2", outcome: { not: "OPEN" } },
      },
    },
  });

  // Build per-dimension buckets
  type Bucket = { count: number; wins: number; losses: number };
  const makeBucket = (): Bucket => ({ count: 0, wins: 0, losses: 0 });

  const buckets = new Map<string, { agreed: Bucket; disagreed: Bucket; neutral: Bucket }>();
  for (const dim of DIMENSIONS) {
    buckets.set(dim, { agreed: makeBucket(), disagreed: makeBucket(), neutral: makeBucket() });
  }

  for (const idea of ideas) {
    const conf = idea.confluence as ConfluenceJson | null;
    if (!conf) continue;

    const t2 = idea.levels[0];
    if (!t2) continue;
    const isWin = t2.outcome === "WIN";

    for (const dim of DIMENSIONS) {
      const score = conf[dim] ?? 0;
      const dimBuckets = buckets.get(dim)!;

      const bucket =
        score === 1 ? dimBuckets.agreed :
        score === -1 ? dimBuckets.disagreed :
        dimBuckets.neutral;

      bucket.count++;
      if (isWin) bucket.wins++;
      else bucket.losses++;
    }
  }

  const dimensions: ConfluenceDimensionStats[] = DIMENSIONS.map((dim) => {
    const b = buckets.get(dim)!;
    const winRate = (bucket: Bucket) =>
      bucket.count > 0 ? bucket.wins / bucket.count : null;

    return {
      dimension: dim,
      agreed: { ...b.agreed, winRate: winRate(b.agreed) },
      disagreed: { ...b.disagreed, winRate: winRate(b.disagreed) },
      neutral: { ...b.neutral, winRate: winRate(b.neutral) },
    };
  });

  return { dimensions };
}
