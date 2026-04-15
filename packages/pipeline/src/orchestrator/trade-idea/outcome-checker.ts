/**
 * Trade Idea Outcome Checker
 *
 * Daily cron that:
 * 1. Queries all trade ideas with at least one OPEN level
 * 2. Fetches new 4H candles since last check
 * 3. Appends return data points (shared returns curve for charting)
 * 4. Checks each level independently for resolution:
 *    - TARGET levels resolve as WIN when price reaches them
 *    - INVALIDATION levels resolve as LOSS when price reaches them
 * 5. Computes quality score with time decay per level
 *
 * Quality formula: quality = returnPct × e^(-t/τ)
 *   - Fast hit → high absolute quality (good signal either way)
 *   - Slow hit → low absolute quality (signal was weak)
 *
 * For FLAT ideas: INVALIDATION levels trigger on breakout (LOSS).
 * No TARGET levels for FLAT — staying flat is measured by the returns curve.
 *
 * Returns curve continues until ALL levels are resolved or 30-day cutoff.
 */

import chalk from "chalk";
import { prisma } from "../../storage/db.js";
import { fetchCandlesSince } from "../../shared/binance.js";
import type {
  TradeIdea,
  TradeIdeaLevel,
  TradeIdeaReturn,
} from "../../generated/prisma/client.js";
import type { AssetType } from "../../types.js";

// Time decay constant in hours (~3 days)
const TAU_HOURS = 72;

// Maximum tracking window (30 days in hours)
const MAX_HOURS = 30 * 24;

// ─── Quality scoring ─────────────────────────────────────────────────────────

function timeDecay(hoursAfter: number): number {
  return Math.exp(-hoursAfter / TAU_HOURS);
}

function computeReturnPct(
  direction: string,
  entryPrice: number,
  currentPrice: number,
): number {
  const rawReturn = ((currentPrice - entryPrice) / entryPrice) * 100;
  return direction === "SHORT" ? -rawReturn : rawReturn;
}

function computeQualityAtPoint(returnPct: number, hoursAfter: number): number {
  return returnPct * timeDecay(hoursAfter);
}

// ─── Level resolution checks ─────────────────────────────────────────────────

interface CandleCheck {
  high: number;
  low: number;
  close: number;
  time: number;
}

interface LevelResolution {
  levelId: string;
  outcome: "WIN" | "LOSS";
  qualityScore: number;
  resolvedAt: Date;
}

/**
 * Check whether a TARGET level was hit.
 * For LONG: price high >= target price → WIN
 * For SHORT: price low <= target price → WIN
 */
function checkTargetLevel(
  direction: string,
  level: TradeIdeaLevel,
  candle: CandleCheck,
  hoursAfter: number,
  returnPct: number,
): LevelResolution | null {
  const hit =
    (direction === "LONG" && candle.high >= level.price) ||
    (direction === "SHORT" && candle.low <= level.price);

  if (!hit) return null;

  return {
    levelId: level.id,
    outcome: "WIN",
    qualityScore: computeQualityAtPoint(returnPct, hoursAfter),
    resolvedAt: new Date(candle.time),
  };
}

/**
 * Check whether an INVALIDATION level was hit.
 * For LONG: price low <= invalidation price → LOSS
 * For SHORT: price high >= invalidation price → LOSS
 * For FLAT: price deviates beyond the breakout distance → LOSS
 */
function checkInvalidationLevel(
  idea: TradeIdea,
  level: TradeIdeaLevel,
  candle: CandleCheck,
  hoursAfter: number,
  returnPct: number,
): LevelResolution | null {
  let hit: boolean;

  if (idea.direction === "FLAT") {
    // For FLAT, level.price stores the breakout distance
    const deviation = Math.abs(candle.close - idea.entryPrice);
    hit = deviation > level.price;
  } else {
    hit =
      (idea.direction === "LONG" && candle.low <= level.price) ||
      (idea.direction === "SHORT" && candle.high >= level.price);
  }

  if (!hit) return null;

  const quality = idea.direction === "FLAT"
    ? computeQualityAtPoint(-Math.abs(returnPct), hoursAfter)
    : computeQualityAtPoint(returnPct, hoursAfter);

  return {
    levelId: level.id,
    outcome: "LOSS",
    qualityScore: quality,
    resolvedAt: new Date(candle.time),
  };
}

// ─── Main checker ────────────────────────────────────────────────────────────

type IdeaWithLevels = TradeIdea & { levels: TradeIdeaLevel[] };

async function checkSingleIdea(idea: IdeaWithLevels): Promise<void> {
  const openLevels = new Map(
    idea.levels
      .filter((l) => l.outcome === "OPEN")
      .map((l) => [l.id, l]),
  );

  if (openLevels.size === 0) return;

  // Find the last recorded return point to know where to resume
  const lastReturn = await prisma.tradeIdeaReturn.findFirst({
    where: { tradeIdeaId: idea.id },
    orderBy: { hoursAfter: "desc" },
  });

  const lastCheckedTime = lastReturn
    ? idea.createdAt.getTime() + lastReturn.hoursAfter * 60 * 60 * 1000
    : idea.createdAt.getTime();

  // Fetch 4H candles since last check
  const candles = await fetchCandlesSince(
    idea.asset as AssetType,
    "4h",
    lastCheckedTime,
  );

  if (candles.length === 0) return;

  const returnPoints: Omit<TradeIdeaReturn, "id">[] = [];
  const resolutions: LevelResolution[] = [];

  for (const candle of candles) {
    const hoursAfter = Math.round(
      (candle.time - idea.createdAt.getTime()) / (1000 * 60 * 60),
    );

    if (hoursAfter <= 0) continue;
    if (lastReturn && hoursAfter <= lastReturn.hoursAfter) continue;

    // 30-day hard cutoff — resolve all remaining levels as LOSS
    if (hoursAfter > MAX_HOURS) {
      for (const level of openLevels.values()) {
        resolutions.push({
          levelId: level.id,
          outcome: "LOSS",
          qualityScore: 0,
          resolvedAt: new Date(),
        });
      }
      openLevels.clear();
      break;
    }

    // Compute return for the shared returns curve
    const returnPct = computeReturnPct(
      idea.direction,
      idea.entryPrice,
      candle.close,
    );

    let qualityAtPoint: number;
    if (idea.direction === "FLAT") {
      const deviation =
        (Math.abs(candle.close - idea.entryPrice) / idea.entryPrice) * 100;
      qualityAtPoint = computeQualityAtPoint(-deviation, hoursAfter);
    } else {
      qualityAtPoint = computeQualityAtPoint(returnPct, hoursAfter);
    }

    returnPoints.push({
      tradeIdeaId: idea.id,
      hoursAfter,
      price: candle.close,
      returnPct,
      qualityAtPoint,
    });

    // Check each open level against this candle
    for (const [levelId, level] of openLevels) {
      let resolution: LevelResolution | null = null;

      if (level.type === "TARGET") {
        resolution = checkTargetLevel(idea.direction, level, candle, hoursAfter, returnPct);
      } else {
        resolution = checkInvalidationLevel(idea, level, candle, hoursAfter, returnPct);
      }

      if (resolution) {
        resolutions.push(resolution);
        openLevels.delete(levelId);
      }
    }

    // All levels resolved — no need to process more candles
    if (openLevels.size === 0) break;
  }

  // Batch insert return points
  if (returnPoints.length > 0) {
    await prisma.tradeIdeaReturn.createMany({
      data: returnPoints,
      skipDuplicates: true,
    });
  }

  // Apply resolutions to individual levels
  for (const res of resolutions) {
    await prisma.tradeIdeaLevel.update({
      where: { id: res.levelId },
      data: {
        outcome: res.outcome,
        qualityScore: res.qualityScore,
        resolvedAt: res.resolvedAt,
      },
    });

    const level = idea.levels.find((l) => l.id === res.levelId);
    const typeIcon = level?.type === "TARGET" ? "🎯" : "🛑";
    const outcomeIcon = res.outcome === "WIN" ? chalk.green("✓") : chalk.red("✗");
    console.log(
      `        ${outcomeIcon} ${typeIcon} ${level?.label ?? "?"} → ${res.outcome} ` +
        `(quality: ${res.qualityScore.toFixed(2)})`,
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function checkOutcomes(): Promise<void> {
  // Find all ideas that still have at least one OPEN level
  const openIdeas = await prisma.tradeIdea.findMany({
    where: {
      levels: { some: { outcome: "OPEN" } },
    },
    include: { levels: true },
    orderBy: { createdAt: "asc" },
  });

  if (openIdeas.length === 0) {
    console.log(chalk.dim("      No open trade ideas to check"));
    return;
  }

  console.log(`      Checking ${openIdeas.length} open trade idea(s)...`);

  // Group by asset to minimize Binance API calls
  const byAsset = new Map<string, IdeaWithLevels[]>();
  for (const idea of openIdeas) {
    const existing = byAsset.get(idea.asset) ?? [];
    existing.push(idea);
    byAsset.set(idea.asset, existing);
  }

  for (const [asset, ideas] of byAsset) {
    console.log(`      ${chalk.cyan("▸")} ${asset}: ${ideas.length} idea(s)`);
    for (const idea of ideas) {
      await checkSingleIdea(idea);
    }
  }
}
