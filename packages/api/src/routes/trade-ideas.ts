/**
 * Trade Ideas — API Routes
 *
 * Endpoints for querying trade ideas, their returns curves, and aggregate stats.
 */

import { z } from "zod";
import { describeRoute, validator } from "hono-openapi";
import { prisma } from "@market-intel/pipeline";
import { createController } from "../common/controller.js";
import { AssetParamSchema, PaginationQuerySchema } from "../common/schemas.js";
import {
  tradeIdeaInclude,
  TradeIdeaLevelStats,
  TradeIdeaStats,
  SignalBucket,
  DimensionEffectiveness,
  SignalEffectiveness,
  IdeaSummary,
} from "../lib/trade-ideas.js";
import { AssetType } from "../lib/asset.js";

// ─── GET /latest/:asset ──────────────────────────────────────────────────────

const latestRoute = describeRoute({
  summary: "Get latest trade idea",
  description: "Returns the most recent trade idea for an asset, with full returns curve",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Latest trade idea with returns" },
    404: { description: "No trade idea found for this asset" },
  },
});

export const GetLatestTradeIdeaController = createController({
  build: (factory) =>
    factory.createApp().get("/latest/:asset", latestRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const idea = await prisma.tradeIdea.findFirst({
        where: { asset },
        orderBy: { createdAt: "desc" },
        include: tradeIdeaInclude,
      });
      if (!idea) return c.json({ error: "No trade idea found" } as const, 404);
      return c.json(idea);
    }),
});

// ─── GET /history/:asset ─────────────────────────────────────────────────────

const historyRoute = describeRoute({
  summary: "Get trade idea history",
  description: "Returns recent trade ideas for an asset with outcomes and quality scores",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Array of trade ideas" },
  },
});

export const GetTradeIdeaHistoryController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get(
        "/history/:asset",
        historyRoute,
        validator("param", AssetParamSchema),
        validator("query", PaginationQuerySchema),
        async (c) => {
          const { asset } = c.req.valid("param");
          const { take } = c.req.valid("query");
          const ideas = await prisma.tradeIdea.findMany({
            where: { asset },
            orderBy: { createdAt: "desc" },
            take,
            include: tradeIdeaInclude,
          });
          return c.json(ideas.reverse());
        },
      ),
});

// ─── GET /stats/:asset ──────────────────────────────────────────────────────

const statsRoute = describeRoute({
  summary: "Get trade idea stats",
  description: "Returns aggregate win rate, quality scores, and counts",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Aggregate statistics" },
  },
});

export const GetTradeIdeaStatsController = createController({
  build: (factory) =>
    factory.createApp().get("/stats/:asset", statsRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const stats = await getTradeIdeaStats(asset);
      return c.json(stats);
    }),
});

// ─── GET /by-brief/:briefId ─────────────────────────────────────────────────

const IdParamSchema = z.object({ briefId: z.string().min(1) });

const byBriefRoute = describeRoute({
  summary: "Get trade idea by brief ID",
  description: "Returns the trade idea linked to a specific brief, with full returns curve",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Trade idea with returns" },
    404: { description: "No trade idea for this brief" },
  },
});

export const GetTradeIdeaByBriefController = createController({
  build: (factory) =>
    factory.createApp().get("/by-brief/:briefId", byBriefRoute, validator("param", IdParamSchema), async (c) => {
      const { briefId } = c.req.valid("param");
      const idea = await prisma.tradeIdea.findUnique({
        where: { briefId },
        include: tradeIdeaInclude,
      });
      if (!idea) return c.json({ error: "No trade idea for this brief" } as const, 404);
      return c.json(idea);
    }),
});

// ─── GET /confluence/:asset ──────────────────────────────────────────────────

const confluenceRoute = describeRoute({
  summary: "Get confluence stats",
  description: "Returns per-dimension hit rates bucketed by agreement score (agreed/disagreed/neutral)",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Per-dimension confluence statistics" },
  },
});

export const GetConfluenceStatsController = createController({
  build: (factory) =>
    factory.createApp().get("/confluence/:asset", confluenceRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const stats = await getConfluenceStats(asset);
      return c.json(stats);
    }),
});

// ─── GET /signal-effectiveness/:asset ───────────────────────────────────────

const signalEffectivenessRoute = describeRoute({
  summary: "Get signal effectiveness",
  description:
    "Per-dimension score vs peak return velocity analysis — bucketed hit rates and correlation for weight tuning",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Per-dimension signal effectiveness data" },
  },
});

export const GetSignalEffectivenessController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get(
        "/signal-effectiveness/:asset",
        signalEffectivenessRoute,
        validator("param", AssetParamSchema),
        async (c) => {
          const { asset } = c.req.valid("param");
          const data = await getSignalEffectiveness(asset);
          return c.json(data);
        },
      ),
});

// ─── Composite controller ────────────────────────────────────────────────────

export const TradeIdeasController = createController({
  build: (factory) =>
    factory
      .createApp()
      .route("/", GetLatestTradeIdeaController.build(factory))
      .route("/", GetTradeIdeaHistoryController.build(factory))
      .route("/", GetTradeIdeaStatsController.build(factory))
      .route("/", GetConfluenceStatsController.build(factory))
      .route("/", GetTradeIdeaByBriefController.build(factory))
      .route("/", GetSignalEffectivenessController.build(factory)),
});

export async function getTradeIdeaStats(asset: "BTC" | "ETH"): Promise<TradeIdeaStats> {
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
      stats = {
        type: row.type,
        label: row.label,
        total: 0,
        wins: 0,
        losses: 0,
        open: 0,
        winRate: null,
        avgQuality: null,
      };
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

/**
 * Computes per-dimension hit rates bucketed by agreement score.
 * Uses the T2 (full target) level as the benchmark for win/loss.
 */
export async function getConfluenceStats(asset: AssetType): Promise<ConfluenceStats> {
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

      const bucket = score > 0 ? dimBuckets.agreed : score < 0 ? dimBuckets.disagreed : dimBuckets.neutral;

      bucket.count++;
      if (isWin) bucket.wins++;
      else bucket.losses++;
    }
  }

  const dimensions: ConfluenceDimensionStats[] = DIMENSIONS.map((dim) => {
    const b = buckets.get(dim)!;
    const winRate = (bucket: Bucket) => (bucket.count > 0 ? bucket.wins / bucket.count : null);

    return {
      dimension: dim,
      agreed: { ...b.agreed, winRate: winRate(b.agreed) },
      disagreed: { ...b.disagreed, winRate: winRate(b.disagreed) },
      neutral: { ...b.neutral, winRate: winRate(b.neutral) },
    };
  });

  return { dimensions };
}

// ─── Confluence stats ────────────────────────────────────────────────────────

const DIMENSIONS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;

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
  exchangeFlows?: number;
}

// ─── Signal effectiveness ───────────────────────────────────────────────────

const SCORE_BUCKETS = [
  { range: "strong_against", min: -100, max: -50 },
  { range: "weak_against", min: -50, max: -10 },
  { range: "neutral", min: -10, max: 10 },
  { range: "weak_for", min: 10, max: 50 },
  { range: "strong_for", min: 50, max: 100 },
] as const;

/**
 * Peak return velocity: max(returnPct / hoursAfter),
 * signed positive when the move matches the predicted direction.
 */
function peakVelocity(returns: { hoursAfter: number; returnPct: number }[], direction: string): number | null {
  if (returns.length === 0) return null;
  const sign = direction === "SHORT" ? -1 : 1;
  let best: number | null = null;
  for (const r of returns) {
    if (r.hoursAfter === 0) continue;
    const v = (r.returnPct * sign) / r.hoursAfter;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Pearson correlation between two equal-length arrays. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

/**
 * Per-dimension signal effectiveness: score-bucketed average peak velocity
 * and Pearson correlation between dimension score and peak velocity.
 */
async function getSignalEffectiveness(asset: AssetType): Promise<SignalEffectiveness> {
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset },
    include: { returns: { orderBy: { hoursAfter: "asc" } } },
  });

  const scored: { confluence: ConfluenceJson; velocity: number }[] = [];
  const ideaSummaries: IdeaSummary[] = [];

  for (const idea of ideas) {
    const conf = idea.confluence as ConfluenceJson | null;
    const v = peakVelocity(idea.returns, idea.direction);

    // Find the peak quality return snapshot
    let peakReturn: (typeof idea.returns)[number] | null = null;
    for (const r of idea.returns) {
      if (!peakReturn || Math.abs(r.qualityAtPoint) > Math.abs(peakReturn.qualityAtPoint)) {
        peakReturn = r;
      }
    }

    ideaSummaries.push({
      id: idea.id,
      briefId: idea.briefId,
      direction: idea.direction,
      positionSizePct: idea.positionSizePct,
      createdAt: idea.createdAt.toISOString(),
      peakVelocity: v,
      peakReturnPct: peakReturn?.returnPct ?? null,
      peakHoursAfter: peakReturn?.hoursAfter ?? null,
      peakQuality: peakReturn?.qualityAtPoint ?? null,
    });

    if (!conf || v === null) continue;
    scored.push({ confluence: conf, velocity: v });
  }

  const dimensions: DimensionEffectiveness[] = DIMENSIONS.map((dim) => {
    const pairs: { score: number; velocity: number }[] = [];
    for (const s of scored) {
      const score = s.confluence[dim] ?? 0;
      pairs.push({ score, velocity: s.velocity });
    }

    const buckets: SignalBucket[] = SCORE_BUCKETS.map(({ range, min, max }) => {
      const inBucket = pairs.filter((p) => (range === "strong_for" ? p.score >= min : p.score >= min && p.score < max));
      const count = inBucket.length;
      const avgVelocity = count > 0 ? inBucket.reduce((s, p) => s + p.velocity, 0) / count : null;
      return { range, min, max, count, avgVelocity };
    });

    const correlation = pearson(
      pairs.map((p) => p.score),
      pairs.map((p) => p.velocity),
    );

    return { dimension: dim, buckets, sampleSize: pairs.length, correlation };
  });

  return { dimensions, ideas: ideaSummaries, totalIdeas: ideas.length, totalWithReturns: scored.length };
}
