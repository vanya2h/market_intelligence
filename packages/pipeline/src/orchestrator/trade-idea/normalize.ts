/**
 * Confluence shape normalization.
 *
 * Old shape (legacy, pre -1..+1 migration):
 *   per-dim values are integers in -100..+100 (with weight baked in, can stretch
 *   beyond ±100 when IC weights are non-equal); total in -400..+400; bias.strength
 *   is a 0..100 percentage; weights sum to 4.
 *
 * New shape:
 *   per-dim values are unweighted floats in -1..+1; total is the weighted average
 *   in -1..+1; bias.strength is 0..1; weights sum to 1.
 *
 * This helper:
 * - Detects which shape a row is in (idempotent on already-normalized data).
 * - Converts legacy → new in-memory.
 *
 * Used both at read time (defensive shim in API + IC weight reader) and by the
 * one-shot backfill script that rewrites the persisted JSON.
 */

const DIMENSION_KEYS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
type DimKey = (typeof DIMENSION_KEYS)[number];

/** Anything ≤ 1.5 in magnitude is treated as already-normalized. */
const LEGACY_THRESHOLD = 1.5;

export interface NormalizedBiasFactor {
  dimension: string;
  /** 0..1 */
  score: number;
}

export interface NormalizedBias {
  lean: "LONG" | "SHORT" | "NEUTRAL";
  /** 0..1 */
  strength: number;
  topFactors: NormalizedBiasFactor[];
}

export interface NormalizedSizing {
  positionSizePct: number;
  convictionMultiplier: number;
  dailyVolPct: number;
}

export interface NormalizedWeights {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  calibrated: boolean;
  sampleCount: number;
  ic: { derivatives: number; etfs: number; htf: number; exchangeFlows: number };
}

/** The on-disk confluence shape after normalization. */
export interface NormalizedConfluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
  bias?: NormalizedBias;
  sizing?: NormalizedSizing;
  weights?: NormalizedWeights;
}

export interface NormalizeResult {
  confluence: NormalizedConfluence;
  /** True when the input was in legacy form and got converted. */
  wasLegacy: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Detect whether a confluence object is in the legacy (-100..+100) shape.
 * Heuristic: any per-dim or total value with magnitude > 1.5 is legacy.
 */
function isLegacy(raw: Record<string, unknown>): boolean {
  for (const key of DIMENSION_KEYS) {
    const v = num(raw[key]);
    if (v !== null && Math.abs(v) > LEGACY_THRESHOLD) return true;
  }
  const total = num(raw.total);
  if (total !== null && Math.abs(total) > LEGACY_THRESHOLD) return true;
  // Bias.strength legacy detection: 0..100 vs 0..1.
  const bias = raw.bias as Record<string, unknown> | undefined;
  if (bias) {
    const strength = num(bias.strength);
    if (strength !== null && strength > LEGACY_THRESHOLD) return true;
  }
  return false;
}

/**
 * Normalize a raw confluence JSON value (as stored in `trade_ideas.confluence`)
 * to the new -1..+1 shape.
 *
 * Idempotent for typical data: already-normalized inputs pass through unchanged
 * with `wasLegacy = false`. The heuristic detects legacy via value magnitude
 * and bias.strength > 1, which catches all rows produced by the old code path.
 *
 * Pass `force = true` to skip detection and ALWAYS treat the input as legacy.
 * This is necessary for the first migration pass over a database that is known
 * to be entirely legacy: edge-case rows with tiny integer values (e.g.
 * `deriv=0, etfs=1, total=1` from early pre-IC-weights runs) are
 * indistinguishable from a hypothetical new-format row with `total=1.0`.
 */
export function normalizeConfluenceShape(raw: unknown, force: boolean = false): NormalizeResult {
  if (raw === null || typeof raw !== "object") {
    // Defensive: return a zeroed shape so callers don't have to handle null.
    return {
      confluence: {
        derivatives: 0,
        etfs: 0,
        htf: 0,
        exchangeFlows: 0,
        total: 0,
      },
      wasLegacy: false,
    };
  }

  const obj = raw as Record<string, unknown>;
  const legacy = force || isLegacy(obj);

  // ── Weights ────────────────────────────────────────────────────────────────
  // Need these BEFORE per-dim conversion so we can recover unweighted scores.
  const weightsRaw = obj.weights as Record<string, unknown> | undefined;

  const legacyWeight = (dim: DimKey): number => {
    if (!weightsRaw) return 1;
    const w = num(weightsRaw[dim]);
    return w !== null && w > 0 ? w : 1;
  };

  let normalizedWeights: NormalizedWeights | undefined;
  if (weightsRaw) {
    const ic = (weightsRaw.ic as Record<string, unknown> | undefined) ?? {};
    if (legacy) {
      // Old weights summed to 4 — divide by 4 to make them sum to 1.
      normalizedWeights = {
        derivatives: round3((num(weightsRaw.derivatives) ?? 1) / 4),
        etfs: round3((num(weightsRaw.etfs) ?? 1) / 4),
        htf: round3((num(weightsRaw.htf) ?? 1) / 4),
        exchangeFlows: round3((num(weightsRaw.exchangeFlows) ?? 1) / 4),
        calibrated: weightsRaw.calibrated === true,
        sampleCount: num(weightsRaw.sampleCount) ?? 0,
        ic: {
          derivatives: num(ic.derivatives) ?? 0,
          etfs: num(ic.etfs) ?? 0,
          htf: num(ic.htf) ?? 0,
          exchangeFlows: num(ic.exchangeFlows) ?? 0,
        },
      };
    } else {
      normalizedWeights = {
        derivatives: num(weightsRaw.derivatives) ?? 0.25,
        etfs: num(weightsRaw.etfs) ?? 0.25,
        htf: num(weightsRaw.htf) ?? 0.25,
        exchangeFlows: num(weightsRaw.exchangeFlows) ?? 0.25,
        calibrated: weightsRaw.calibrated === true,
        sampleCount: num(weightsRaw.sampleCount) ?? 0,
        ic: {
          derivatives: num(ic.derivatives) ?? 0,
          etfs: num(ic.etfs) ?? 0,
          htf: num(ic.htf) ?? 0,
          exchangeFlows: num(ic.exchangeFlows) ?? 0,
        },
      };
    }
  }

  // ── Per-dim values ─────────────────────────────────────────────────────────
  const dims: Record<DimKey, number> = {
    derivatives: 0,
    etfs: 0,
    htf: 0,
    exchangeFlows: 0,
  };
  for (const key of DIMENSION_KEYS) {
    const v = num(obj[key]) ?? 0;
    if (legacy) {
      // Recover unweighted normalized score: stored = score × weight, where
      // score ∈ [-100, +100] and weight summed to 4.
      // unweighted = stored / weight / 100. Clamp to safety range.
      dims[key] = round3(clamp(v / legacyWeight(key) / 100, -1, 1));
    } else {
      dims[key] = round3(v);
    }
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  // Old: Σ(unweighted_score_i × weight_i), |total| ≤ 400.
  // New: weighted average in -1..+1. Math: total_new = total_old / 400 (exact,
  // since both sides equal Σ(score_i/100 × weight_i/4)).
  const totalRaw = num(obj.total) ?? 0;
  const total = legacy ? round3(clamp(totalRaw / 400, -1, 1)) : round3(totalRaw);

  // ── Bias ───────────────────────────────────────────────────────────────────
  let normalizedBias: NormalizedBias | undefined;
  const biasRaw = obj.bias as Record<string, unknown> | undefined;
  if (biasRaw) {
    const lean = biasRaw.lean === "LONG" || biasRaw.lean === "SHORT" ? biasRaw.lean : "NEUTRAL";
    const strengthRaw = num(biasRaw.strength) ?? 0;
    const strength = legacy ? round3(clamp(strengthRaw / 100, 0, 1)) : round3(strengthRaw);
    const topFactorsRaw = Array.isArray(biasRaw.topFactors) ? (biasRaw.topFactors as unknown[]) : [];
    const topFactors: NormalizedBiasFactor[] = topFactorsRaw
      .map((f) => {
        if (f === null || typeof f !== "object") return null;
        const fObj = f as Record<string, unknown>;
        const dimension = typeof fObj.dimension === "string" ? fObj.dimension : "";
        const score = num(fObj.score) ?? 0;
        if (!dimension) return null;
        const normalizedScore = legacy ? round3(clamp(score / 100, -1, 1)) : round3(score);
        return { dimension, score: normalizedScore };
      })
      .filter((f): f is NormalizedBiasFactor => f !== null);
    normalizedBias = { lean, strength, topFactors };
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────
  // Sizing fields are in their own units (% notional, multiplier, vol %),
  // unaffected by the score-scale migration.
  let normalizedSizing: NormalizedSizing | undefined;
  const sizingRaw = obj.sizing as Record<string, unknown> | undefined;
  if (sizingRaw) {
    normalizedSizing = {
      positionSizePct: num(sizingRaw.positionSizePct) ?? 0,
      convictionMultiplier: num(sizingRaw.convictionMultiplier) ?? 0,
      dailyVolPct: num(sizingRaw.dailyVolPct) ?? 0,
    };
  }

  return {
    confluence: {
      derivatives: dims.derivatives,
      etfs: dims.etfs,
      htf: dims.htf,
      exchangeFlows: dims.exchangeFlows,
      total,
      ...(normalizedBias ? { bias: normalizedBias } : {}),
      ...(normalizedSizing ? { sizing: normalizedSizing } : {}),
      ...(normalizedWeights ? { weights: normalizedWeights } : {}),
    },
    wasLegacy: legacy,
  };
}
