/**
 * Orchestrator — Delta Analysis
 *
 * Compares current dimension contexts against the previous brief's contexts
 * to compute per-metric deltas normalized by historical sigma.
 *
 * Produces a DeltaSummary that drives brief generation:
 *   - High significance  → full brief (standard path)
 *   - Medium significance → delta-focused brief (LLM emphasizes changes)
 *   - Low significance   → deterministic one-liner (no LLM call)
 */

import { prisma } from "../storage/db.js";
import type { $Enums } from "../generated/prisma/client.js";
import type { DimensionOutput } from "./types.js";

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Max z-score above which we produce a full brief */
const HIGH_THRESHOLD = 3.5;
/** Max z-score below which we produce a one-liner */
const LOW_THRESHOLD = 0.5;
/** Number of historical briefs to use for sigma calculation */
const HISTORY_DEPTH = 20;
/** Minimum sigma to avoid division by near-zero */
const MIN_SIGMA = 1e-9;

// ─── Types ───────────────────────────────────────────────────────────────────

export type SignificanceTier = "high" | "medium" | "low";

export interface MetricDelta {
  /** Dot-path into the dimension context (e.g. "signals.fundingPct1m") */
  path: string;
  /** Human-readable label */
  label: string;
  /** Previous value */
  prev: number;
  /** Current value */
  curr: number;
  /** Absolute delta */
  delta: number;
  /** Historical standard deviation of run-to-run deltas */
  sigma: number;
  /** |delta| / sigma */
  zScore: number;
}

export interface DimensionDelta {
  dimension: DimensionOutput["dimension"];
  regimeFlipped: boolean;
  prevRegime: string | null;
  currRegime: string;
  topMovers: MetricDelta[];
}

export interface DeltaSummary {
  /** Overall significance tier */
  tier: SignificanceTier;
  /** Max z-score across all metrics */
  maxZ: number;
  /** Per-dimension deltas */
  dimensions: DimensionDelta[];
  /** Human-readable summary of what changed (for injection into LLM prompt) */
  changeSummary: string;
  /** The single most significant tension (for the one-liner) */
  topTension: string;
}

// ─── Metric Registry ─────────────────────────────────────────────────────────
//
// Each entry: [dot-path into context, human-readable label]
// We only track metrics that are meaningful for detecting market changes.
// Skipping: absolute prices (they always move), array fields, string/enum fields.

type MetricSpec = [path: string, label: string];

const DERIVATIVES_METRICS: MetricSpec[] = [
  ["signals.fundingPct1m", "Funding percentile (1m)"],
  ["signals.oiZScore30d", "OI z-score (30d)"],
  ["signals.oiChange24h", "OI change (24h)"],
  ["signals.oiChange7d", "OI change (7d)"],
  ["signals.liqPct1m", "Liquidation percentile (1m)"],
  ["signals.fundingPressureCycles", "Funding pressure cycles"],
  ["funding.current", "Funding rate"],
  ["funding.percentile.1m", "Funding percentile rank (1m)"],
  ["openInterest.current", "Open interest"],
  ["openInterest.percentile.1m", "OI percentile rank (1m)"],
  ["liquidations.current8h", "Liquidations (8h)"],
  ["coinbasePremium.current", "Coinbase premium"],
  ["coinbasePremium.percentile.1m", "CB premium percentile (1m)"],
];

const ETFS_METRICS: MetricSpec[] = [
  ["flow.todaySigma", "ETF flow z-score (today)"],
  ["flow.percentile1m", "ETF flow percentile (1m)"],
  ["flow.today", "ETF flow (today)"],
  ["flow.d3Sum", "ETF flow (3d sum)"],
  ["flow.d7Sum", "ETF flow (7d sum)"],
  ["flow.consecutiveInflowDays", "Consecutive inflow days"],
  ["flow.consecutiveOutflowDays", "Consecutive outflow days"],
  ["flow.reversalRatio", "ETF reversal ratio"],
  ["totalAumUsd", "Total AUM"],
];

const HTF_METRICS: MetricSpec[] = [
  ["ma.priceVsSma50Pct", "Price vs SMA50 (%)"],
  ["ma.priceVsSma200Pct", "Price vs SMA200 (%)"],
  ["rsi.daily", "RSI (daily)"],
  ["rsi.h4", "RSI (4h)"],
  ["cvd.futures.short.slope", "CVD futures short slope"],
  ["cvd.futures.short.r2", "CVD futures short R²"],
  ["cvd.futures.long.slope", "CVD futures long slope"],
  ["cvd.spot.short.slope", "CVD spot short slope"],
  ["cvd.spot.long.slope", "CVD spot long slope"],
  ["volatility.atrPercentile", "ATR percentile"],
  ["volatility.atrRatio", "ATR ratio"],
  ["volatility.recentDisplacement", "Recent displacement"],
  ["volumeProfile.profile.priceVsPocPct", "Price vs POC (%)"],
];

const SENTIMENT_METRICS: MetricSpec[] = [
  ["metrics.compositeIndex", "Composite F&G index"],
  ["metrics.components.positioning", "Positioning score"],
  ["metrics.components.trend", "Trend score"],
  ["metrics.components.momentumDivergence", "Momentum divergence score"],
  ["metrics.components.institutionalFlows", "Institutional flows score"],
  ["metrics.components.exchangeFlows", "Exchange flows score"],
  ["metrics.consensusIndex", "Consensus index"],
  ["metrics.zScore", "Sentiment z-score"],
  ["metrics.bullishRatio", "Bullish ratio"],
];

const EXCHANGE_FLOWS_METRICS: MetricSpec[] = [
  ["metrics.todaySigma", "Exchange flow z-score"],
  ["metrics.flowPercentile1m", "Flow percentile (1m)"],
  ["metrics.reserveChange1dPct", "Reserve change (1d %)"],
  ["metrics.reserveChange7dPct", "Reserve change (7d %)"],
  ["metrics.reserveChange30dPct", "Reserve change (30d %)"],
  ["metrics.netFlow1d", "Net flow (1d)"],
  ["metrics.netFlow7d", "Net flow (7d)"],
];

const METRIC_REGISTRY: Record<DimensionOutput["dimension"], MetricSpec[]> = {
  DERIVATIVES: DERIVATIVES_METRICS,
  ETFS: ETFS_METRICS,
  HTF: HTF_METRICS,
  SENTIMENT: SENTIMENT_METRICS,
  EXCHANGE_FLOWS: EXCHANGE_FLOWS_METRICS,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely get a nested numeric value from an object by dot-path */
function getByPath(obj: unknown, path: string): number | null {
  const val = getByPathRaw(obj, path);
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

/** Safely get a nested string value from an object by dot-path */
function getStringByPath(obj: unknown, path: string): string | null {
  const val = getByPathRaw(obj, path);
  return typeof val === "string" ? val : null;
}

function getByPathRaw(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

/** Compute standard deviation of an array of numbers */
function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ─── Previous brief loading ──────────────────────────────────────────────────

interface PreviousBriefContexts {
  derivatives: Record<string, unknown> | null;
  etfs: Record<string, unknown> | null;
  htf: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
  exchangeFlows: Record<string, unknown> | null;
}

async function loadPreviousBriefContexts(asset: $Enums.Asset): Promise<PreviousBriefContexts | null> {
  const brief = await prisma.brief.findFirst({
    where: { asset },
    orderBy: { timestamp: "desc" },
    select: {
      derivatives: { select: { context: true } },
      etfs: { select: { context: true } },
      htf: { select: { context: true } },
      sentiment: { select: { context: true } },
      exchangeFlows: { select: { context: true } },
    },
  });

  if (!brief) return null;

  return {
    derivatives: brief.derivatives?.context as Record<string, unknown> | null,
    etfs: brief.etfs?.context as Record<string, unknown> | null,
    htf: brief.htf?.context as Record<string, unknown> | null,
    sentiment: brief.sentiment?.context as Record<string, unknown> | null,
    exchangeFlows: brief.exchangeFlows?.context as Record<string, unknown> | null,
  };
}

/** Load a specific brief's contexts by ID */
async function loadBriefContextsById(briefId: string): Promise<PreviousBriefContexts | null> {
  const brief = await prisma.brief.findUnique({
    where: { id: briefId },
    select: {
      derivatives: { select: { context: true } },
      etfs: { select: { context: true } },
      htf: { select: { context: true } },
      sentiment: { select: { context: true } },
      exchangeFlows: { select: { context: true } },
    },
  });

  if (!brief) return null;

  return {
    derivatives: brief.derivatives?.context as Record<string, unknown> | null,
    etfs: brief.etfs?.context as Record<string, unknown> | null,
    htf: brief.htf?.context as Record<string, unknown> | null,
    sentiment: brief.sentiment?.context as Record<string, unknown> | null,
    exchangeFlows: brief.exchangeFlows?.context as Record<string, unknown> | null,
  };
}

/** Load the last N brief contexts for sigma computation */
async function loadHistoricalContexts(
  asset: $Enums.Asset,
  limit: number,
): Promise<PreviousBriefContexts[]> {
  const briefs = await prisma.brief.findMany({
    where: { asset },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      derivatives: { select: { context: true } },
      etfs: { select: { context: true } },
      htf: { select: { context: true } },
      sentiment: { select: { context: true } },
      exchangeFlows: { select: { context: true } },
    },
  });

  return briefs.map((b) => ({
    derivatives: b.derivatives?.context as Record<string, unknown> | null,
    etfs: b.etfs?.context as Record<string, unknown> | null,
    htf: b.htf?.context as Record<string, unknown> | null,
    sentiment: b.sentiment?.context as Record<string, unknown> | null,
    exchangeFlows: b.exchangeFlows?.context as Record<string, unknown> | null,
  }));
}

// ─── Sigma computation ───────────────────────────────────────────────────────

type DimensionKey = "derivatives" | "etfs" | "htf" | "sentiment" | "exchangeFlows";

const DIMENSION_TO_KEY: Record<DimensionOutput["dimension"], DimensionKey> = {
  DERIVATIVES: "derivatives",
  ETFS: "etfs",
  HTF: "htf",
  SENTIMENT: "sentiment",
  EXCHANGE_FLOWS: "exchangeFlows",
};

/** Dot-path to the regime field within each dimension's context JSON.
 *  Derivatives is special: it has positioning.state, not regime. */
const REGIME_PATH: Record<DimensionOutput["dimension"], string> = {
  DERIVATIVES: "positioning.state",
  ETFS: "regime",
  HTF: "regime",
  SENTIMENT: "regime",
  EXCHANGE_FLOWS: "regime",
};

/**
 * For each metric in a dimension, compute the historical sigma of run-to-run deltas.
 * Returns a map of dot-path → sigma.
 */
function computeSigmas(
  history: PreviousBriefContexts[],
  dimKey: DimensionKey,
  metrics: MetricSpec[],
): Map<string, number> {
  const sigmas = new Map<string, number>();

  for (const [path] of metrics) {
    // Extract the time-series of values for this metric across historical briefs
    const values: number[] = [];
    for (const h of history) {
      const ctx = h[dimKey];
      if (!ctx) continue;
      const v = getByPath(ctx, path);
      if (v !== null) values.push(v);
    }

    // Compute consecutive deltas
    const deltas: number[] = [];
    for (let i = 1; i < values.length; i++) {
      deltas.push(values[i - 1]! - values[i]!); // newer - older (history is desc)
    }

    sigmas.set(path, deltas.length >= 2 ? stdev(deltas) : 0);
  }

  return sigmas;
}

// ─── Delta computation ───────────────────────────────────────────────────────

function computeDimensionDelta(
  dimension: DimensionOutput["dimension"],
  currentCtx: Record<string, unknown>,
  prevCtx: Record<string, unknown> | null,
  sigmas: Map<string, number>,
  currRegime: string,
  prevRegime: string | null,
): DimensionDelta {
  const metrics = METRIC_REGISTRY[dimension];
  const movers: MetricDelta[] = [];

  if (prevCtx) {
    for (const [path, label] of metrics) {
      const curr = getByPath(currentCtx, path);
      const prev = getByPath(prevCtx, path);
      if (curr === null || prev === null) continue;

      const delta = curr - prev;
      const sigma = sigmas.get(path) ?? 0;
      const zScore = sigma > MIN_SIGMA ? Math.abs(delta) / sigma : delta !== 0 ? Infinity : 0;

      movers.push({ path, label, prev, curr, delta, sigma, zScore });
    }
  }

  // Sort by z-score descending so topMovers[0] is the biggest change
  movers.sort((a, b) => b.zScore - a.zScore);

  return {
    dimension,
    regimeFlipped: prevRegime !== null && prevRegime !== currRegime,
    prevRegime,
    currRegime,
    topMovers: movers.slice(0, 5), // keep top 5 per dimension
  };
}

// ─── Change summary builder ──────────────────────────────────────────────────

function buildChangeSummary(dimensions: DimensionDelta[]): string {
  const lines: string[] = [];

  for (const dim of dimensions) {
    if (dim.regimeFlipped) {
      lines.push(`${dim.dimension}: regime flipped ${dim.prevRegime} → ${dim.currRegime}`);
    }
    const significant = dim.topMovers.filter((m) => m.zScore > LOW_THRESHOLD);
    if (significant.length > 0) {
      const parts = significant
        .slice(0, 3)
        .map((m) => {
          const dir = m.delta > 0 ? "↑" : "↓";
          return `${m.label} ${dir} (z=${m.zScore.toFixed(1)})`;
        });
      lines.push(`${dim.dimension}: ${parts.join(", ")}`);
    }
  }

  if (lines.length === 0) return "No meaningful changes across any dimension.";
  return lines.join("\n");
}

function buildTopTension(dimensions: DimensionDelta[], outputs: DimensionOutput[]): string {
  // Strategy: find the two dimensions with the most opposed regimes,
  // or fall back to the single highest z-score metric.

  // Collect all regime sentiments
  const bullishRegimes = new Set([
    "CROWDED_LONG", "STRONG_INFLOW", "REVERSAL_TO_INFLOW",
    "MACRO_BULLISH", "BULL_EXTENDED", "RECLAIMING",
    "GREED", "EXTREME_GREED", "CONSENSUS_BULLISH",
    "ACCUMULATION",
  ]);
  const bearishRegimes = new Set([
    "CROWDED_SHORT", "STRONG_OUTFLOW", "REVERSAL_TO_OUTFLOW",
    "MACRO_BEARISH", "BEAR_EXTENDED", "DISTRIBUTION",
    "FEAR", "EXTREME_FEAR", "CONSENSUS_BEARISH",
    "HEAVY_INFLOW", // exchange inflows = bearish (selling pressure)
  ]);

  const bullish: string[] = [];
  const bearish: string[] = [];

  for (const dim of dimensions) {
    if (bullishRegimes.has(dim.currRegime)) bullish.push(dim.dimension);
    else if (bearishRegimes.has(dim.currRegime)) bearish.push(dim.dimension);
  }

  // If we have opposing dimensions, that's the tension
  if (bullish.length > 0 && bearish.length > 0) {
    const bLabel = bullish.join(" + ");
    const sLabel = bearish.join(" + ");
    return `${bLabel} leaning bullish while ${sLabel} leaning bearish`;
  }

  // Otherwise, find the single most notable metric
  const allMovers = dimensions.flatMap((d) => d.topMovers);
  allMovers.sort((a, b) => b.zScore - a.zScore);
  const topMover = allMovers[0];
  if (topMover && topMover.zScore > 0) {
    const dir = topMover.delta > 0 ? "up" : "down";
    return `${topMover.label} trending ${dir}`;
  }

  // Absolute fallback: use the first dimension's regime
  const firstOutput = outputs[0];
  if (firstOutput) {
    return `Market in ${firstOutput.regime} regime`;
  }

  return "Markets quiet, no significant signals";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ComputeDeltaOptions {
  /** Override the previous brief to compare against (by brief ID). */
  previousBriefId?: string;
}

/**
 * Compute the delta between current dimension outputs and the most recent
 * persisted brief for this asset. Returns a DeltaSummary that tells the
 * synthesizer how much has changed.
 */
export async function computeDelta(
  asset: $Enums.Asset,
  outputs: DimensionOutput[],
  opts: ComputeDeltaOptions = {},
): Promise<DeltaSummary> {
  // Load previous brief contexts + historical contexts for sigma (parallel)
  const [prevContexts, history] = await Promise.all([
    opts.previousBriefId
      ? loadBriefContextsById(opts.previousBriefId)
      : loadPreviousBriefContexts(asset),
    loadHistoricalContexts(asset, HISTORY_DEPTH),
  ]);

  // No history → first run, everything is significant
  if (!prevContexts) {
    return {
      tier: "high",
      maxZ: Infinity,
      dimensions: [],
      changeSummary: "First brief for this asset — all data is new.",
      topTension: "",
    };
  }

  const dimensions: DimensionDelta[] = [];
  let maxZ = 0;

  for (const output of outputs) {
    const dimKey = DIMENSION_TO_KEY[output.dimension];
    const prevCtx = prevContexts[dimKey];
    const currentCtx = output.context as unknown as Record<string, unknown>;
    const metrics = METRIC_REGISTRY[output.dimension];

    // Compute sigmas from historical data
    const sigmas = computeSigmas(history, dimKey, metrics);

    // Get regime strings — always compare against the previous brief's stored
    // regime, NOT the analyzer's internal previousRegime field (which tracks
    // state across analytical runs, not across briefs).
    const regimePath = REGIME_PATH[output.dimension];
    const currRegime = getStringByPath(currentCtx, regimePath) ?? "";
    const prevRegime = prevCtx
      ? getStringByPath(prevCtx, regimePath)
      : null;

    const dimDelta = computeDimensionDelta(
      output.dimension,
      currentCtx,
      prevCtx,
      sigmas,
      currRegime,
      prevRegime,
    );

    dimensions.push(dimDelta);

    // Regime flip always counts as high significance
    if (dimDelta.regimeFlipped) maxZ = Math.max(maxZ, HIGH_THRESHOLD + 1);

    // Track max z-score
    const topMover = dimDelta.topMovers[0];
    if (topMover) {
      maxZ = Math.max(maxZ, topMover.zScore);
    }
  }

  const tier: SignificanceTier =
    maxZ > HIGH_THRESHOLD ? "high" : maxZ > LOW_THRESHOLD ? "medium" : "low";

  return {
    tier,
    maxZ,
    dimensions,
    changeSummary: buildChangeSummary(dimensions),
    topTension: buildTopTension(dimensions, outputs),
  };
}
