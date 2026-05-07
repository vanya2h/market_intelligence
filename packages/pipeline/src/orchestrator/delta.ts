/**
 * Orchestrator — Multi-horizon Delta Analysis
 *
 * Compares the current snapshot against snapshots at three time horizons —
 * 1 hour, 4 hours, 24 hours — using the per-dim snapshot tables that the
 * hourly snapshot job (orchestrator/snapshot.ts) writes.
 *
 * For each metric we compute one HorizonDelta per horizon. Sigma at horizon H
 * is the stdev of (v_t − v_{t−H}) pairs across the rolling 30-day history.
 * The headline z-score is the max |z| across the three horizons; the
 * `MetricDelta.prev/delta/sigma/zScore` fields surface that headline so the
 * existing synthesizer prompt and debug scripts keep working without churn.
 *
 * Tier:
 *   maxZ > HIGH_THRESHOLD  → "high"   (full brief)
 *   maxZ > LOW_THRESHOLD   → "medium" (delta-focused brief)
 *   else                   → "low"    (deterministic one-liner)
 */
import type { $Enums } from "../generated/prisma/client.js";
import { prisma } from "../storage/db.js";
import type { DimensionOutput } from "./types.js";

// ─── Tunables ───────────────────────────────────────────────────────────────

const HIGH_THRESHOLD = 3.5;
const LOW_THRESHOLD = 0.5;
/** How many hourly snapshots to load for sigma computation (30 days × 24h). */
const HISTORY_HOURS = 30 * 24;
const MIN_SIGMA = 1e-9;

// ─── Types ──────────────────────────────────────────────────────────────────

export type SignificanceTier = "high" | "medium" | "low";
export type Horizon = "h1" | "h4" | "h24";

const HORIZON_HOURS: Record<Horizon, number> = { h1: 1, h4: 4, h24: 24 };
const HORIZON_LABELS: Record<Horizon, string> = { h1: "1h", h4: "4h", h24: "24h" };

export interface HorizonDelta {
  prev: number;
  delta: number;
  sigma: number;
  zScore: number;
}

export interface MetricDelta {
  /** Snapshot column name (kept as `path` for synthesizer/debug-script compat). */
  path: string;
  label: string;
  curr: number;
  /** Per-horizon breakdown. Missing horizons (insufficient history) are zeroed. */
  horizons: Record<Horizon, HorizonDelta>;
  /** Horizon that produced the headline z-score. */
  headlineHorizon: Horizon;
  // Headline values (mirror of horizons[headlineHorizon]) for back-compat.
  prev: number;
  delta: number;
  sigma: number;
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
  tier: SignificanceTier;
  maxZ: number;
  dimensions: DimensionDelta[];
  changeSummary: string;
  topTension: string;
}

// ─── Per-dim column registry ────────────────────────────────────────────────

type ColumnSpec = [column: string, label: string];

const DERIVATIVES_COLUMNS: ColumnSpec[] = [
  ["fundingPct1m", "Funding percentile (1m)"],
  ["oiZScore30d", "OI z-score (30d)"],
  ["oiChange24h", "OI change (24h)"],
  ["oiChange7d", "OI change (7d)"],
  ["liqPct1m", "Liquidation percentile (1m)"],
  ["fundingPressureCycles", "Funding pressure cycles"],
  ["fundingCurrent", "Funding rate"],
  ["fundingPercentile1m", "Funding percentile rank (1m)"],
  ["oiCurrent", "Open interest"],
  ["oiPercentile1m", "OI percentile rank (1m)"],
  ["liq8h", "Liquidations (8h)"],
  ["cbPremiumCurrent", "Coinbase premium"],
  ["cbPremiumPercentile1m", "CB premium percentile (1m)"],
];

const ETFS_COLUMNS: ColumnSpec[] = [
  ["flowTodaySigma", "ETF flow z-score (today)"],
  ["flowPercentile1m", "ETF flow percentile (1m)"],
  ["flowToday", "ETF flow (today)"],
  ["flowD3Sum", "ETF flow (3d sum)"],
  ["flowD7Sum", "ETF flow (7d sum)"],
  ["consecutiveInflowDays", "Consecutive inflow days"],
  ["consecutiveOutflowDays", "Consecutive outflow days"],
  ["reversalRatio", "ETF reversal ratio"],
  ["totalAumUsd", "Total AUM"],
];

const HTF_COLUMNS: ColumnSpec[] = [
  ["priceVsSma50Pct", "Price vs SMA50 (%)"],
  ["priceVsSma200Pct", "Price vs SMA200 (%)"],
  ["rsiDaily", "RSI (daily)"],
  ["rsiH4", "RSI (4h)"],
  ["cvdFutShortSlope", "CVD futures short slope"],
  ["cvdFutShortR2", "CVD futures short R²"],
  ["cvdFutLongSlope", "CVD futures long slope"],
  ["cvdSpotShortSlope", "CVD spot short slope"],
  ["cvdSpotLongSlope", "CVD spot long slope"],
  ["atrPercentile", "ATR percentile"],
  ["atrRatio", "ATR ratio"],
  ["recentDisplacement", "Recent displacement"],
  ["priceVsPocPct", "Price vs POC (%)"],
];

const SENTIMENT_COLUMNS: ColumnSpec[] = [
  ["compositeIndex", "Composite F&G index"],
  ["positioning", "Positioning score"],
  ["trend", "Trend score"],
  ["momentumDivergence", "Momentum divergence score"],
  ["institutionalFlows", "Institutional flows score"],
  ["exchangeFlows", "Exchange flows score"],
  ["consensusIndex", "Consensus index"],
  ["sentZScore", "Sentiment z-score"],
  ["bullishRatio", "Bullish ratio"],
];

const EXCHANGE_FLOWS_COLUMNS: ColumnSpec[] = [
  ["flowTodaySigma", "Exchange flow z-score"],
  ["flowPercentile1m", "Flow percentile (1m)"],
  ["reserveChange1dPct", "Reserve change (1d %)"],
  ["reserveChange7dPct", "Reserve change (7d %)"],
  ["reserveChange30dPct", "Reserve change (30d %)"],
  ["netFlow1d", "Net flow (1d)"],
  ["netFlow7d", "Net flow (7d)"],
];

const COLUMNS: Record<DimensionOutput["dimension"], ColumnSpec[]> = {
  DERIVATIVES: DERIVATIVES_COLUMNS,
  ETFS: ETFS_COLUMNS,
  HTF: HTF_COLUMNS,
  SENTIMENT: SENTIMENT_COLUMNS,
  EXCHANGE_FLOWS: EXCHANGE_FLOWS_COLUMNS,
};

// ─── Snapshot history loaders ───────────────────────────────────────────────

/** Snapshot row reduced to `{ timestamp, regime, [col]: number | null }`. */
type SnapshotRow = { timestamp: Date; regime: string } & Record<string, unknown>;

async function loadHistory(
  dimension: DimensionOutput["dimension"],
  asset: $Enums.Asset,
): Promise<SnapshotRow[]> {
  const args = { where: { asset }, orderBy: { timestamp: "desc" as const }, take: HISTORY_HOURS };
  switch (dimension) {
    case "DERIVATIVES":
      return (await prisma.derivativesSnapshot.findMany(args)) as unknown as SnapshotRow[];
    case "ETFS":
      return (await prisma.etfsSnapshot.findMany(args)) as unknown as SnapshotRow[];
    case "HTF":
      return (await prisma.htfSnapshot.findMany(args)) as unknown as SnapshotRow[];
    case "SENTIMENT":
      return (await prisma.sentimentSnapshot.findMany(args)) as unknown as SnapshotRow[];
    case "EXCHANGE_FLOWS":
      return (await prisma.exchangeFlowsSnapshot.findMany(args)) as unknown as SnapshotRow[];
  }
}

// ─── Math helpers ───────────────────────────────────────────────────────────

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Find the snapshot in `history` (sorted desc by timestamp) whose timestamp
 * is closest-but-not-after `target`. Returns null if the oldest row is still
 * newer than target.
 */
function findAtOrBefore(history: SnapshotRow[], target: number): SnapshotRow | null {
  for (const row of history) {
    if (row.timestamp.getTime() <= target) return row;
  }
  return null;
}

/**
 * Stdev of (v_t − v_{t−H}) pairs across history. Steps the index by H hours
 * (history is hourly), pairing each row with the row H steps later in the
 * desc-sorted array.
 */
function horizonSigma(history: SnapshotRow[], column: string, horizonHours: number): number {
  const deltas: number[] = [];
  for (let i = 0; i + horizonHours < history.length; i++) {
    const newer = asNumber(history[i]![column]);
    const older = asNumber(history[i + horizonHours]![column]);
    if (newer === null || older === null) continue;
    deltas.push(newer - older);
  }
  return stdev(deltas);
}

// ─── Per-dim delta ──────────────────────────────────────────────────────────

const REGIME_HEADLINE_HORIZON: Horizon = "h4";

function buildHorizonDelta(
  curr: number,
  history: SnapshotRow[],
  column: string,
  horizon: Horizon,
  nowMs: number,
): HorizonDelta {
  const targetMs = nowMs - HORIZON_HOURS[horizon] * 60 * 60 * 1000;
  const prevRow = findAtOrBefore(history, targetMs);
  const prev = prevRow ? asNumber(prevRow[column]) : null;
  if (prev === null) return { prev: 0, delta: 0, sigma: 0, zScore: 0 };

  const delta = curr - prev;
  const sigma = horizonSigma(history, column, HORIZON_HOURS[horizon]);
  const zScore = sigma > MIN_SIGMA ? Math.abs(delta) / sigma : 0;
  return { prev, delta, sigma, zScore };
}

function computeDimensionDelta(
  output: DimensionOutput,
  history: SnapshotRow[],
  nowMs: number,
): DimensionDelta {
  const movers: MetricDelta[] = [];
  const current = history[0];

  for (const [column, label] of COLUMNS[output.dimension]) {
    const curr = current ? asNumber(current[column]) : null;
    if (curr === null) continue;

    const horizons: Record<Horizon, HorizonDelta> = {
      h1: buildHorizonDelta(curr, history, column, "h1", nowMs),
      h4: buildHorizonDelta(curr, history, column, "h4", nowMs),
      h24: buildHorizonDelta(curr, history, column, "h24", nowMs),
    };

    let headlineHorizon: Horizon = "h1";
    let maxZ = horizons.h1.zScore;
    for (const h of ["h4", "h24"] as Horizon[]) {
      if (horizons[h].zScore > maxZ) {
        maxZ = horizons[h].zScore;
        headlineHorizon = h;
      }
    }
    const headline = horizons[headlineHorizon];

    movers.push({
      path: column,
      label,
      curr,
      horizons,
      headlineHorizon,
      prev: headline.prev,
      delta: headline.delta,
      sigma: headline.sigma,
      zScore: headline.zScore,
    });
  }

  movers.sort((a, b) => b.zScore - a.zScore);

  // Regime flip is computed against the same horizon used for headline regime
  // comparisons (4h ≈ one brief cycle).
  const targetMs = nowMs - HORIZON_HOURS[REGIME_HEADLINE_HORIZON] * 60 * 60 * 1000;
  const prevRegimeRow = findAtOrBefore(history, targetMs);
  const prevRegime = prevRegimeRow ? prevRegimeRow.regime : null;

  return {
    dimension: output.dimension,
    regimeFlipped: prevRegime !== null && prevRegime !== output.regime,
    prevRegime,
    currRegime: output.regime,
    topMovers: movers.slice(0, 5),
  };
}

// ─── Summary builders ───────────────────────────────────────────────────────

function buildChangeSummary(dimensions: DimensionDelta[]): string {
  const lines: string[] = [];
  for (const dim of dimensions) {
    if (dim.regimeFlipped) {
      lines.push(`${dim.dimension}: regime flipped ${dim.prevRegime} → ${dim.currRegime}`);
    }
    const significant = dim.topMovers.filter((m) => m.zScore > LOW_THRESHOLD);
    if (significant.length === 0) continue;
    const parts = significant.slice(0, 3).map((m) => {
      const dir = m.delta > 0 ? "↑" : "↓";
      return `${m.label} ${dir} (z=${m.zScore.toFixed(1)} on ${HORIZON_LABELS[m.headlineHorizon]})`;
    });
    lines.push(`${dim.dimension}: ${parts.join(", ")}`);
  }
  if (lines.length === 0) return "No meaningful changes across any dimension.";
  return lines.join("\n");
}

function buildTopTension(dimensions: DimensionDelta[], outputs: DimensionOutput[]): string {
  const bullishRegimes = new Set([
    "CROWDED_LONG",
    "STRONG_INFLOW",
    "REVERSAL_TO_INFLOW",
    "MACRO_BULLISH",
    "BULL_EXTENDED",
    "RECLAIMING",
    "GREED",
    "EXTREME_GREED",
    "CONSENSUS_BULLISH",
    "ACCUMULATION",
  ]);
  const bearishRegimes = new Set([
    "CROWDED_SHORT",
    "STRONG_OUTFLOW",
    "REVERSAL_TO_OUTFLOW",
    "MACRO_BEARISH",
    "BEAR_EXTENDED",
    "DISTRIBUTION",
    "FEAR",
    "EXTREME_FEAR",
    "CONSENSUS_BEARISH",
    "HEAVY_INFLOW", // exchange inflows = bearish
  ]);

  const bullish: string[] = [];
  const bearish: string[] = [];
  for (const d of dimensions) {
    if (bullishRegimes.has(d.currRegime)) bullish.push(d.dimension);
    else if (bearishRegimes.has(d.currRegime)) bearish.push(d.dimension);
  }
  if (bullish.length > 0 && bearish.length > 0) {
    return `${bullish.join(" + ")} leaning bullish while ${bearish.join(" + ")} leaning bearish`;
  }

  const allMovers = dimensions.flatMap((d) => d.topMovers).sort((a, b) => b.zScore - a.zScore);
  const top = allMovers[0];
  if (top && top.zScore > 0) {
    const dir = top.delta > 0 ? "up" : "down";
    return `${top.label} trending ${dir} on ${HORIZON_LABELS[top.headlineHorizon]}`;
  }
  const first = outputs[0];
  return first ? `Market in ${first.regime} regime` : "Markets quiet, no significant signals";
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ComputeDeltaOptions {
  /** Deprecated. Multi-horizon delta no longer compares against a specific
   *  prior brief — it compares against fixed time offsets via the snapshot
   *  history. Kept on the type for callsite compatibility; ignored. */
  previousBriefId?: string;
}

export async function computeDelta(
  asset: $Enums.Asset,
  outputs: DimensionOutput[],
  _opts: ComputeDeltaOptions = {},
): Promise<DeltaSummary> {
  const nowMs = Date.now();
  const dimensions: DimensionDelta[] = [];
  let maxZ = 0;
  let hadHistory = false;

  for (const output of outputs) {
    const history = await loadHistory(output.dimension, asset);
    if (history.length === 0) continue;
    hadHistory = true;

    const dimDelta = computeDimensionDelta(output, history, nowMs);
    dimensions.push(dimDelta);

    if (dimDelta.regimeFlipped) maxZ = Math.max(maxZ, HIGH_THRESHOLD + 1);
    const top = dimDelta.topMovers[0];
    if (top) maxZ = Math.max(maxZ, top.zScore);
  }

  if (!hadHistory) {
    return {
      tier: "high",
      maxZ: Infinity,
      dimensions: [],
      changeSummary: "First brief for this asset — all data is new.",
      topTension: "",
    };
  }

  const tier: SignificanceTier = maxZ > HIGH_THRESHOLD ? "high" : maxZ > LOW_THRESHOLD ? "medium" : "low";

  return {
    tier,
    maxZ,
    dimensions,
    changeSummary: buildChangeSummary(dimensions),
    topTension: buildTopTension(dimensions, outputs),
  };
}
