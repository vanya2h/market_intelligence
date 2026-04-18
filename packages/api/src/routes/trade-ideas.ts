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
  MonthlyReturn,
  PerformanceMetrics,
  StrategyPoint,
  Strategy,
  StrategyCurvesData,
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

// ─── GET /performance/:asset ────────────────────────────────────────────────

const performanceRoute = describeRoute({
  summary: "Get performance metrics",
  description: "Monthly returns, cumulative PnL, and Sharpe ratio — size-weighted by conviction",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Performance metrics with monthly breakdown" },
  },
});

export const GetPerformanceController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get("/performance/:asset", performanceRoute, validator("param", AssetParamSchema), async (c) => {
        const { asset } = c.req.valid("param");
        const data = await getPerformanceMetrics(asset);
        return c.json(data);
      }),
});

// ─── GET /performance/strategy-curves/:asset ────────────────────────────────

const strategyCurvesRoute = describeRoute({
  summary: "Get strategy equity curves",
  description:
    "Per-level strategy cumulative return curves — compares T1/T2/T3 targets and S1–S4 stop strategies",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Strategy curves data" },
  },
});

export const GetStrategyCurvesController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get(
        "/performance/strategy-curves/:asset",
        strategyCurvesRoute,
        validator("param", AssetParamSchema),
        async (c) => {
          const { asset } = c.req.valid("param");
          const data = await getStrategyCurves(asset);
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
      .route("/", GetSignalEffectivenessController.build(factory))
      .route("/", GetPerformanceController.build(factory))
      .route("/", GetStrategyCurvesController.build(factory)),
});

export async function getTradeIdeaStats(asset: AssetType): Promise<TradeIdeaStats> {
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

// Score range cuts on the new -1..+1 normalized scale.
const SCORE_BUCKETS = [
  { range: "strong_against", min: -1, max: -0.5 },
  { range: "weak_against", min: -0.5, max: -0.1 },
  { range: "neutral", min: -0.1, max: 0.1 },
  { range: "weak_for", min: 0.1, max: 0.5 },
  { range: "strong_for", min: 0.5, max: 1 },
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

    return {
      dimension: dim,
      buckets,
      sampleSize: pairs.length,
      correlation,
    };
  });

  return {
    dimensions,
    ideas: ideaSummaries,
    totalIdeas: ideas.length,
    totalWithReturns: scored.length,
  };
}

// ─── Performance metrics ───────────────────────────────────────────────────

/**
 * Position size multiplier: 2.0 × conviction^1.5
 * Matches the new sizing curve in packages/pipeline/src/orchestrator/trade-idea/sizing.ts
 */
function sizeMultiplier(conviction: number): number {
  return 2.0 * Math.pow(Math.max(conviction, 0), 1.5);
}

/**
 * Normalise a raw confluence total before feeding it into sizeMultiplier.
 *
 * Three data generations exist in the DB:
 *   - Apr 6–10: IC weights summed to 4 → total ∈ -400..+400
 *   - Apr 11+:  weights sum to 1        → total ∈ -1..+1   ← expected by sizeMultiplier
 *
 * Heuristic (same threshold used by the backfill script): any |total| > 1.5
 * is legacy and must be divided by 400 to land on the current scale.
 */
function normalizeConviction(total: number): number {
  return Math.abs(total) > 1.5 ? total / 400 : total;
}

/**
 * Compute monthly returns, cumulative PnL, and Sharpe ratio.
 *
 * Each idea's PnL = sizeMultiplier(confluence.total) × peakReturn.
 * Monthly returns are the sum of per-idea PnLs within each calendar month.
 * Sharpe = mean(monthlyReturns) / std(monthlyReturns) × √12 (annualized).
 */
async function getPerformanceMetrics(asset: AssetType): Promise<PerformanceMetrics> {
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset },
    include: { returns: { orderBy: { hoursAfter: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  // Compute per-idea metrics
  const rows: { month: string; pnl: number; size: number; peakReturn: number; win: boolean }[] = [];

  for (const idea of ideas) {
    if (idea.returns.length === 0) continue;
    const conf = idea.confluence as (ConfluenceJson & { total?: number }) | null;
    const total = conf?.total ?? 0;
    const size = sizeMultiplier(normalizeConviction(total));

    // Peak return: snapshot with highest |qualityAtPoint|
    const peak = idea.returns.reduce((best, r) =>
      Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
    );

    const pnl = size * peak.returnPct;
    const month = idea.createdAt.toISOString().slice(0, 7); // YYYY-MM

    rows.push({ month, pnl, size, peakReturn: peak.returnPct, win: peak.returnPct > 0 });
  }

  // Group by month
  const monthMap = new Map<string, { pnls: number[]; sizes: number[]; returns: number[]; wins: number }>();
  for (const row of rows) {
    const entry = monthMap.get(row.month) ?? { pnls: [], sizes: [], returns: [], wins: 0 };
    entry.pnls.push(row.pnl);
    entry.sizes.push(row.size);
    entry.returns.push(row.peakReturn);
    if (row.win) entry.wins++;
    monthMap.set(row.month, entry);
  }

  const months: MonthlyReturn[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => {
      const count = data.pnls.length;
      return {
        month,
        pnl: round2(data.pnls.reduce((a: number, b: number) => a + b, 0)),
        count,
        avgSize: round2(data.sizes.reduce((a: number, b: number) => a + b, 0) / count),
        winRate: round2(data.wins / count),
        avgReturn: round2(data.returns.reduce((a: number, b: number) => a + b, 0) / count),
      };
    });

  // Overall metrics
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  const totalWins = rows.filter((r) => r.win).length;
  const avgSize = rows.length > 0 ? rows.reduce((s, r) => s + r.size, 0) / rows.length : 0;

  // Sharpe ratio: annualized from monthly PnLs
  const monthlyPnls = months.map((m) => m.pnl);
  let sharpe: number | null = null;
  if (monthlyPnls.length >= 2) {
    const mean = monthlyPnls.reduce((a, b) => a + b, 0) / monthlyPnls.length;
    const variance = monthlyPnls.reduce((s, p) => s + (p - mean) ** 2, 0) / monthlyPnls.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      sharpe = round2((mean / std) * Math.sqrt(12));
    }
  }

  return {
    months,
    totalPnl: round2(totalPnl),
    sharpe,
    totalIdeas: rows.length,
    avgPnlPerIdea: rows.length > 0 ? round2(totalPnl / rows.length) : 0,
    winRate: rows.length > 0 ? round2(totalWins / rows.length) : 0,
    avgSize: round2(avgSize),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Strategy curves ─────────────────────────────────────────────────────────

/**
 * Builds three paired strategy equity curves:
 *   Strategy 1 → T1 target + S1 stop
 *   Strategy 2 → T2 target + S2 stop
 *   Strategy 3 → T3 target + S3 stop
 *
 * For each idea the exit is whichever of the two paired levels resolves first.
 * Return = sign × (exitPrice − entry) / entry × 100.
 * Points are sorted by resolvedAt and cumulated in order.
 */
async function getStrategyCurves(asset: AssetType): Promise<StrategyCurvesData> {
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset },
    include: { levels: true },
    orderBy: { createdAt: "asc" },
  });

  // All permutations of target × stop levels
  const PAIRINGS = (["T1", "T2", "T3"] as const).flatMap((t) =>
    (["S1", "S2", "S3"] as const).map((s) => ({
      name: `${t}:${s}`,
      targetLabel: t,
      stopLabel: s,
    })),
  );

  type RawPoint = Omit<StrategyPoint, "cumulativeReturn">;

  function buildCurve(rawPoints: RawPoint[]): StrategyPoint[] {
    rawPoints.sort((a, b) => a.resolvedAt.localeCompare(b.resolvedAt));
    let cum = 0;
    return rawPoints.map((p) => {
      cum += p.ideaReturn;
      return { ...p, cumulativeReturn: round2(cum) };
    });
  }

  const strategies: Strategy[] = PAIRINGS.map(({ name, targetLabel, stopLabel }) => {
    // Derive the 0-based index from the label suffix ("T1"→0, "T2"→1, "T3"→2 / "S1"→0 …)
    const targetIdx = parseInt(targetLabel.slice(1), 10) - 1;
    const stopIdx = parseInt(stopLabel.slice(1), 10) - 1;

    const rawPoints: RawPoint[] = [];
    let wins = 0;

    for (const idea of ideas) {
      const sign = idea.direction === "SHORT" ? -1 : 1;

      // Try label match first; fall back to positional (by distance from entry)
      // so that ideas created before the T/S labeling scheme are still included.
      const byDist = (a: { price: number }, b: { price: number }) =>
        Math.abs(a.price - idea.entryPrice) - Math.abs(b.price - idea.entryPrice);

      const targetLevels = idea.levels
        .filter((l) => l.type === "TARGET")
        .sort(byDist);
      const stopLevels = idea.levels
        .filter((l) => l.type === "INVALIDATION")
        .sort(byDist);

      const target =
        idea.levels.find((l) => l.label === targetLabel && l.type === "TARGET") ??
        targetLevels[targetIdx];
      const stop =
        idea.levels.find((l) => l.label === stopLabel && l.type === "INVALIDATION") ??
        stopLevels[stopIdx];

      if (!target || !stop) continue;

      let exitLevel: typeof target | typeof stop | null = null;
      let exitTime = Infinity;

      if (target.outcome !== "OPEN" && target.resolvedAt) {
        const t = target.resolvedAt.getTime();
        if (t < exitTime) { exitTime = t; exitLevel = target; }
      }
      if (stop.outcome !== "OPEN" && stop.resolvedAt) {
        const t = stop.resolvedAt.getTime();
        if (t < exitTime) { exitTime = t; exitLevel = stop; }
      }

      if (!exitLevel) continue;

      const conf = idea.confluence as (ConfluenceJson & { total?: number }) | null;
      const size = sizeMultiplier(normalizeConviction(conf?.total ?? 0));
      const rawReturn = (sign * (exitLevel.price - idea.entryPrice)) / idea.entryPrice * 100;
      const returnPct = round2(rawReturn * size);
      const outcome = exitLevel.type === "TARGET" ? "WIN" : "LOSS";
      if (outcome === "WIN") wins++;

      rawPoints.push({
        resolvedAt: exitLevel.resolvedAt!.toISOString(),
        ideaReturn: returnPct,
        outcome,
      });
    }

    const points = buildCurve(rawPoints);
    const totalReturn = points.length > 0 ? points[points.length - 1]!.cumulativeReturn : 0;

    return {
      name,
      label: name, // e.g. "T1:S1"
      points,
      totalIdeas: points.length,
      wins,
      winRate: points.length > 0 ? round2(wins / points.length) : null,
      totalReturn,
    };
  });

  return { strategies };
}
