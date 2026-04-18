/**
 * IC-Based Dimension Weights
 *
 * Computes Information Coefficient (IC) per dimension from historical
 * trade idea outcomes, then derives optimal weights using IC / σ.
 *
 * Grounded in the Fundamental Law of Active Management (IR = IC × √N):
 * dimensions with higher predictive accuracy and lower noise receive
 * more weight in the confluence score. This replaces equal weighting
 * with empirically calibrated weights.
 *
 * When historical data is insufficient (< MIN_SAMPLES resolved ideas),
 * falls back to equal weights (1.0 each, sum = 4).
 */

import type { $Enums } from "../../generated/prisma/client.js";
import { prisma } from "../../storage/db.js";
import { getRedis } from "../../storage/redis.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export const DIMENSION_KEYS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export interface DimensionWeights {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  /** Whether IC-based weights were computed (true) or equal fallback used (false) */
  calibrated: boolean;
  /** Number of resolved trade ideas used for calibration */
  sampleCount: number;
  /** Per-dimension IC values (for diagnostics / logging) */
  ic: Record<DimensionKey, number>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum resolved trade ideas required to trust IC estimates */
const MIN_SAMPLES = 20;

/**
 * EMA smoothing factor for IC values.
 * α = 0.1 → half-life ≈ 6–7 hourly runs.
 * A single new resolved idea shifts weights by only ~10% of what a fresh
 * recompute would produce, preventing intra-session weight flips.
 */
const IC_EMA_ALPHA = 0.1;

/** Redis key prefix for persisted smoothed IC values */
const IC_EMA_KEY_PREFIX = "ic_ema:";

/**
 * Floor weight — no dimension drops below this even with poor IC.
 * Prevents a dimension from being fully silenced due to a bad streak
 * while still allowing significant re-weighting.
 * Weights now sum to 1; floor of 0.0625 means worst case a dimension gets
 * 1/16 of the total weight (same fraction as before, when weights summed to 4
 * and the floor was 0.25).
 */
const WEIGHT_FLOOR = 0.0625;

/**
 * Total weight after normalization. Set to 1 so the confluence total is a
 * weighted average in -1..+1, invariant to dimension count.
 */
const WEIGHT_SUM = 1;

// ─── Statistics ─────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Pearson correlation between two arrays.
 * Returns 0 if either array has zero variance (no information).
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;

  const mx = mean(xs);
  const my = mean(ys);

  let cov = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? 0 : cov / denom;
}

// ─── IC EMA persistence ─────────────────────────────────────────────────────

type SmoothedIc = Record<DimensionKey, number>;

function icEmaKey(asset: $Enums.Asset): string {
  return `${IC_EMA_KEY_PREFIX}${asset}`;
}

async function loadSmoothedIc(asset: $Enums.Asset): Promise<SmoothedIc | null> {
  try {
    return await getRedis().get<SmoothedIc>(icEmaKey(asset));
  } catch {
    return null;
  }
}

async function saveSmoothedIc(asset: $Enums.Asset, ic: SmoothedIc): Promise<void> {
  try {
    // No TTL — smoothed ICs are intentionally long-lived state
    await getRedis().set(icEmaKey(asset), ic);
  } catch {
    // Non-fatal: next run will recompute from fresh ICs
  }
}

// ─── Equal weights fallback ─────────────────────────────────────────────────

/**
 * Equal weights — used as fallback and by debug scripts.
 * Each dimension gets `WEIGHT_SUM / N_DIMS` so the weights sum to 1
 * (= 0.25 each for 4 dims).
 */
export const EQUAL_WEIGHTS: DimensionWeights = {
  derivatives: WEIGHT_SUM / DIMENSION_KEYS.length,
  etfs: WEIGHT_SUM / DIMENSION_KEYS.length,
  htf: WEIGHT_SUM / DIMENSION_KEYS.length,
  exchangeFlows: WEIGHT_SUM / DIMENSION_KEYS.length,
  calibrated: false,
  sampleCount: 0,
  ic: {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  },
};

function equalWeights(sampleCount: number = 0): DimensionWeights {
  return { ...EQUAL_WEIGHTS, sampleCount };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute IC-based dimension weights from historical trade idea outcomes.
 *
 * For each resolved trade idea:
 * - Determines if the directional call was correct (first level to resolve:
 *   TARGET WIN = correct, INVALIDATION LOSS = incorrect)
 * - Records each dimension's conviction score from the stored confluence
 *
 * Then computes per-dimension:
 * - IC = Pearson correlation between scores and outcomes (+1/-1)
 * - σ = standard deviation of scores
 * - Raw weight = max(IC, 0) / σ  (anti-predictive dims get floor weight)
 *
 * Weights are normalized to sum to 1, so the confluence total stays a weighted
 * average in -1..+1 invariant to dimension count. Per-dim scores are read from
 * the persisted (already normalized) confluence JSON.
 */
export async function computeDimensionWeights(asset: $Enums.Asset): Promise<DimensionWeights> {
  const ideas = await prisma.tradeIdea.findMany({
    where: {
      asset,
      levels: { some: { outcome: { not: "OPEN" } } },
    },
    include: {
      levels: {
        where: { outcome: { not: "OPEN" } },
        orderBy: { resolvedAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (ideas.length < MIN_SAMPLES) return equalWeights(ideas.length);

  // Extract samples: per-dimension scores + binary outcome
  const scores: Record<DimensionKey, number[]> = {
    derivatives: [],
    etfs: [],
    htf: [],
    exchangeFlows: [],
  };
  const outcomes: number[] = [];

  for (const idea of ideas) {
    const conf = idea.confluence as Record<string, number> | null;
    if (!conf) continue;

    // First resolved level determines correctness of the directional call
    const firstResolved = idea.levels[0]; // already sorted by resolvedAt
    if (!firstResolved) continue;

    const correct = firstResolved.type === "TARGET" && firstResolved.outcome === "WIN";
    const outcome = correct ? 1 : -1;

    outcomes.push(outcome);
    for (const dim of DIMENSION_KEYS) {
      scores[dim].push(conf[dim] ?? 0);
    }
  }

  if (outcomes.length < MIN_SAMPLES) return equalWeights(outcomes.length);

  // Compute fresh IC and σ per dimension
  const freshIc: Record<DimensionKey, number> = {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  };
  const sigma: Record<DimensionKey, number> = {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  };

  for (const dim of DIMENSION_KEYS) {
    freshIc[dim] = pearsonCorrelation(scores[dim], outcomes);
    sigma[dim] = stddev(scores[dim]);
  }

  // EMA smoothing — blend fresh ICs with persisted smoothed ICs.
  // On first run (no stored ICs), seeds EMA with fresh values.
  const prevIc = await loadSmoothedIc(asset);
  const ic: Record<DimensionKey, number> = { ...freshIc };
  if (prevIc) {
    for (const dim of DIMENSION_KEYS) {
      ic[dim] = IC_EMA_ALPHA * freshIc[dim] + (1 - IC_EMA_ALPHA) * prevIc[dim];
    }
  }
  await saveSmoothedIc(asset, ic);

  // Raw weight = max(IC, 0) / σ
  // Anti-predictive dimensions (IC < 0) get floor weight rather than inverse weight
  const rawWeights: Record<DimensionKey, number> = {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  };

  for (const dim of DIMENSION_KEYS) {
    if (sigma[dim] > 0 && ic[dim] > 0) {
      rawWeights[dim] = ic[dim] / sigma[dim];
    }
    // else: 0 (will be floored below)
  }

  // Apply floor and normalize to sum = N_DIMS
  const totalRaw = DIMENSION_KEYS.reduce((sum, dim) => sum + rawWeights[dim], 0);

  if (totalRaw === 0) return equalWeights(outcomes.length);

  // First pass: normalize to sum = WEIGHT_SUM (= 1)
  const normalized: Record<DimensionKey, number> = {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  };
  for (const dim of DIMENSION_KEYS) {
    normalized[dim] = (rawWeights[dim] / totalRaw) * WEIGHT_SUM;
  }

  // Second pass: apply floor and redistribute
  let deficit = 0;
  let aboveFloorSum = 0;
  for (const dim of DIMENSION_KEYS) {
    if (normalized[dim] < WEIGHT_FLOOR) {
      deficit += WEIGHT_FLOOR - normalized[dim];
      normalized[dim] = WEIGHT_FLOOR;
    } else {
      aboveFloorSum += normalized[dim];
    }
  }

  // Redistribute deficit proportionally from above-floor dimensions
  if (deficit > 0 && aboveFloorSum > 0) {
    for (const dim of DIMENSION_KEYS) {
      if (normalized[dim] > WEIGHT_FLOOR) {
        normalized[dim] -= deficit * (normalized[dim] / aboveFloorSum);
      }
    }
  }

  return {
    derivatives: round3(normalized.derivatives),
    etfs: round3(normalized.etfs),
    htf: round3(normalized.htf),
    exchangeFlows: round3(normalized.exchangeFlows),
    calibrated: true,
    sampleCount: outcomes.length,
    ic,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
