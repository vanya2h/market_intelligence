/**
 * Raw feature extraction for per-dimension ML sub-models.
 *
 * Converts each dimension's typed context into a flat Record<string, number>
 * where categoricals are amplitude-encoded ([-1, +1]) using feature_schema.json,
 * and numerics are passed through as-is.
 *
 * The feature keys match feature_schema.json `feature_sets.*` exactly so
 * the Python training script and this module stay in lockstep.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EtfContext } from "../../etfs/types.js";
import type { ExchangeFlowsContext } from "../../exchange_flows/types.js";
import type { HtfContext } from "../../htf/types.js";
import type { DerivativesContext } from "../../types.js";
import type {
  DerivativesOutput,
  DimensionOutput,
  EtfsOutput,
  ExchangeFlowsOutput,
  HtfOutput,
} from "../types.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

interface FeatureSchema {
  categoricals: Record<string, Record<string, number>>;
}

const schema = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../training/feature_schema.json"), "utf-8"),
) as FeatureSchema;

const CATEGORICALS = schema.categoricals;

/**
 * Encode a categorical string value to its amplitude scalar.
 * Unknown values and null/undefined default to 0.0 before the decay is applied.
 * Null values are looked up as the literal key "null" (for FundingPressureSide etc.).
 */
function encode(enumName: string, value: string | null | undefined, decay = 1.0): number {
  const map = CATEGORICALS[enumName];
  if (!map) return 0.0;
  const key = value ?? "null";
  return (map[key] ?? 0.0) * decay;
}

// ─── Staleness normalisation ──────────────────────────────────────────────────

// Candles since a signal peaked. Absent (null) → -1 sentinel; present → [0, 1].
const STALENESS_MAX_CANDLES = 20;

function normStaleness(v: number | null): number {
  if (v === null) return -1;
  return Math.min(v / STALENESS_MAX_CANDLES, 1);
}

// ─── Per-dimension extractors ─────────────────────────────────────────────────

function extractDerivatives(ctx: DerivativesContext): Record<string, number> {
  const s = ctx.signals;
  return {
    // Numeric
    fundingPct1m: s.fundingPct1m,
    liqPct1m: s.liqPct1m,
    liqPct3m: s.liqPct3m,
    oiChange24h: s.oiChange24h,
    oiChange7d: s.oiChange7d,
    oiZScore30d: s.oiZScore30d,
    fundingPressureCycles: s.fundingPressureCycles,
    cbPremiumPercentile1m: ctx.coinbasePremium.percentile["1m"],
    // Categorical → amplitude
    positioningState: encode("PositioningRegime", ctx.positioning.state),
    previousPositioning: encode("PositioningRegime", ctx.previousPositioning, 0.5),
    stressState: encode("StressLevel", ctx.stress.state),
    previousStress: encode("StressLevel", ctx.previousStress, 0.5),
    oiSignal: encode("OiSignal", ctx.oiSignal),
    fundingPressureSide: encode("FundingPressureSide", s.fundingPressureSide),
  };
}

function extractEtfs(ctx: EtfContext): Record<string, number> {
  const f = ctx.flow;
  return {
    // Numeric
    todaySigma: f.todaySigma,
    consecutiveInflowDays: f.consecutiveInflowDays,
    consecutiveOutflowDays: f.consecutiveOutflowDays,
    reversalRatio: f.reversalRatio,
    priorStreakSigmas: f.sigma30d > 0 ? f.priorStreakFlow / f.sigma30d : 0,
    percentile1m: f.percentile1m,
    // dataFreshness added after initial schema — older rows lack it; default to fresh (1.0)
    dataFreshnessWeight: ctx.dataFreshness?.weight ?? 1.0,
    // Categorical → amplitude
    regime: encode("EtfRegime", ctx.regime),
    previousRegime: encode("EtfRegime", ctx.previousRegime, 0.5),
  };
}

function extractHtf(ctx: HtfContext): Record<string, number> {
  // Several sub-objects were added after the initial schema — guard each independently.
  const bias = ctx.bias as typeof ctx.bias | undefined;
  const mfi = ctx.mfi as typeof ctx.mfi | undefined;
  const vp = ctx.volumeProfile as typeof ctx.volumeProfile | undefined;
  const dc = ctx.divergenceConfluence as typeof ctx.divergenceConfluence | undefined;
  const staleness = ctx.staleness as typeof ctx.staleness | undefined;
  return {
    // Bias components (pre-computed by analyzer — kept as model priors)
    biasComposite: bias?.composite ?? 0,
    biasTrend: bias?.trend ?? 0,
    biasMomentum: bias?.momentum ?? 0,
    biasFlow: bias?.flow ?? 0,
    biasCompression: bias?.compression ?? 0,
    biasVpGravity: bias?.vpGravity ?? 0,
    biasSthGravity: bias?.sthGravity ?? 0,
    // Numeric
    rsiDaily: ctx.rsi.daily,
    rsiH4: ctx.rsi.h4,
    mfiDaily: mfi?.daily ?? 0,
    mfiH4: mfi?.h4 ?? 0,
    divergenceConfluenceStrength: dc?.strength ?? 0,
    atrPercentile: ctx.volatility?.atrPercentile ?? 0,
    atrRatio: ctx.volatility?.atrRatio ?? 0,
    recentDisplacement: ctx.volatility?.recentDisplacement ?? 0,
    nearPriceVsPocPct: vp?.near?.priceVsPocPct ?? 0,
    structuralPriceVsPocPct: vp?.structural?.priceVsPocPct ?? 0,
    priceVsSthPct: ctx.sth?.priceVsSthPct ?? 0,
    // Staleness: -1 = signal absent, 0 = fresh, 1 = stale (20+ candles)
    stalenessRsiExtreme: normStaleness(staleness?.rsiExtreme ?? null),
    stalenessMfiExtreme: normStaleness(staleness?.mfiExtreme ?? null),
    stalenessCvdDivergencePeak: normStaleness(staleness?.cvdDivergencePeak ?? null),
    // Categorical → amplitude
    regime: encode("HtfRegime", ctx.regime),
    previousRegime: encode("HtfRegime", ctx.previousRegime, 0.5),
    structure: encode("MarketStructure", ctx.structure),
    cvdFuturesDivergence: encode("CvdDivergence", ctx.cvd.futures.divergence),
    cvdFuturesMechanism: encode("CvdDivergenceMechanism", ctx.cvd.futures.divergenceMechanism),
    cvdFuturesShortRegime: encode("CvdRegime", ctx.cvd.futures.short.regime),
    cvdFuturesLongRegime: encode("CvdRegime", ctx.cvd.futures.long.regime, 0.7),
    cvdFuturesExtreme: encode("CvdExtreme", ctx.cvd.futures.extreme?.state),
    cvdSpotDivergence: encode("CvdDivergence", ctx.cvd.spot.divergence),
    spotFuturesDivergence: encode("SpotFuturesCvdDivergence", ctx.cvd.spotFuturesDivergence),
    rsiDivergence: encode("RsiDivergence", ctx.rsi.divergence),
    mfiDivergence: encode("MfiDivergence", mfi?.divergence),
    divergenceConfluenceDir: encode("DivergenceConfluenceDirection", dc?.direction),
    nearVpPosition: encode("VolumeProfilePosition", vp?.near?.pricePosition),
    structuralVpPosition: encode("VolumeProfilePosition", vp?.structural?.pricePosition),
    maCrossType: encode("MaCrossType", ctx.ma.crossType),
    maRecentCross: encode("MaCrossType", ctx.ma.recentCross, 0.6),
  };
}

function extractExchangeFlows(ctx: ExchangeFlowsContext): Record<string, number> {
  const m = ctx.metrics;
  return {
    // Numeric
    reserveChange1dPct: m.reserveChange1dPct,
    reserveChange7dPct: m.reserveChange7dPct,
    reserveChange30dPct: m.reserveChange30dPct,
    netFlow7d: m.netFlow7d,
    netFlow30d: m.netFlow30d,
    todaySigma: m.todaySigma,
    flowPercentile1m: m.flowPercentile1m,
    // Categorical → amplitude
    regime: encode("ExchangeFlowsRegime", ctx.regime),
    previousRegime: encode("ExchangeFlowsRegime", ctx.previousRegime, 0.5),
    balanceTrend: encode("BalanceTrend", m.balanceTrend),
    // Boolean → signed scalar (separate features: low and high are independent)
    isAt30dLow: m.isAt30dLow ? 1.0 : 0.0,
    isAt30dHigh: m.isAt30dHigh ? -1.0 : 0.0,
  };
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isDerivatives(o: DimensionOutput): o is DerivativesOutput {
  return o.dimension === "DERIVATIVES";
}
function isEtfs(o: DimensionOutput): o is EtfsOutput {
  return o.dimension === "ETFS";
}
function isHtf(o: DimensionOutput): o is HtfOutput {
  return o.dimension === "HTF";
}
function isExchangeFlows(o: DimensionOutput): o is ExchangeFlowsOutput {
  return o.dimension === "EXCHANGE_FLOWS";
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RawFeaturesByDim {
  DERIVATIVES: Record<string, number>;
  ETFS: Record<string, number>;
  HTF: Record<string, number>;
  EXCHANGE_FLOWS: Record<string, number>;
}

/**
 * Extract raw features from all dimension outputs.
 * Missing dimensions produce an empty object (model inference will fall back to heuristic).
 */
export function extractRawFeatures(outputs: DimensionOutput[]): RawFeaturesByDim {
  const deriv = outputs.find(isDerivatives);
  const etfs = outputs.find(isEtfs);
  const htf = outputs.find(isHtf);
  const ef = outputs.find(isExchangeFlows);

  return {
    DERIVATIVES: deriv ? extractDerivatives(deriv.context) : {},
    ETFS: etfs ? extractEtfs(etfs.context) : {},
    HTF: htf ? extractHtf(htf.context) : {},
    EXCHANGE_FLOWS: ef ? extractExchangeFlows(ef.context) : {},
  };
}
