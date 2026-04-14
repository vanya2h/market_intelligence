/**
 * Confluence Scoring
 *
 * Each dimension produces a conviction score from -1 to +1 relative to the
 * trade idea direction:
 *   +1 = maximum agreement (dimension strongly supports direction)
 *   -1 = maximum disagreement (dimension strongly opposes direction)
 *    0 = neutral / no signal
 *
 * Per-dim values are unweighted normalized scores. The total is the weighted
 * average across all dimensions (Σ score_i × weight_i, with Σweight_i = 1),
 * also in -1..+1 — and crucially, invariant to the number of dimensions.
 *
 * Adding or removing a dimension only changes what gets averaged; the displayed
 * range and every downstream threshold stay valid.
 *
 * Every trade is taken; position size scales with conviction (see sizing.ts).
 *
 * Sentiment is excluded from scoring — it is a composite of derivatives (50%),
 * ETFs (30%), and HTF (20%), so including it would triple-count those dimensions.
 * It remains valuable as a narrative/context layer for the LLM synthesizer.
 */

import type { AnalysisSignals, DerivativesContext } from "../../types.js";
import type { EtfContext } from "../../etfs/types.js";
import type { HtfContext } from "../../htf/types.js";

import type { ExchangeFlowsContext } from "../../exchange_flows/types.js";
import type { DimensionOutput } from "../types.js";
import type { Direction } from "./composite-target.js";
import type { DimensionWeights } from "./ic-weights.js";

export interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Flip score for SHORT direction (signals that agree with LONG disagree with SHORT) */
function directional(score: number, direction: Direction): number {
  return direction === "SHORT" ? -score : score;
}

// ─── Derivatives (-100 to +100) ─────────────────────────────────────────────
// Mean-reversion signals — only fire at genuine extremes.
// Moderate readings produce ~0 to avoid noise in trending markets.
//   - Positioning: CROWDED states spike, OI z-score baseline (dead zone z < 1.5)
//   - Stress: CAPITULATION/UNWINDING spike, baseline requires elevated liq/OI
//   - Funding: trend-phase-aware — fresh extremes are trend-following, decays
//     toward mean-reversion as time passes or exhaustion signals fire
//   - Coinbase premium: sigmoid with dead zone (pctl 35-65 → ~0)

// Component weights
const DERIV_W_POSITIONING = 0.3;
const DERIV_W_STRESS = 0.2;
const DERIV_W_FUNDING = 0.3;
const DERIV_W_CBPREMIUM = 0.2;

// ─── Funding: Trend-Phase-Aware Scoring ─────────────────────────────────────
// Funding rate percentile is a powerful signal, but its meaning depends on
// where we are in the trend lifecycle:
//   - Early in a trend (fresh extreme): elevated funding confirms the move.
//     Longs paying = bullish conviction, not exhaustion.
//   - As time passes without exhaustion, conviction decays exponentially.
//   - When exhaustion signals fire (CVD divergence, RSI stretched, OI declining),
//     the signal flips to mean-reversion: elevated funding = bearish.
//
// Decay constant τ=5 cycles (~40h at 8h funding intervals).
// Exhaustion accelerates decay by up to 6 effective cycles.

const FUNDING_DECAY_TAU = 5;
const FUNDING_EXHAUSTION_ACCEL = 6;
const FUNDING_DEAD_ZONE = 20; // ±20 pctl points around median (widened from 15)

/**
 * Detect trend exhaustion from HTF momentum indicators.
 * Returns 0..1 where 0 = no exhaustion, 1 = fully exhausted.
 */
function computeExhaustion(
  htfCtx: HtfContext,
  signals: AnalysisSignals,
  fundingSide: "LONG" | "SHORT" | null,
): number {
  if (!fundingSide) return 0;

  let score = 0;
  const cvd = htfCtx.cvd;

  // 1. CVD exhaustion mechanism (strongest signal: 0.35)
  //    If longs are paying (LONG side) and CVD shows bearish divergence → trend fading.
  //    EXHAUSTION mechanism (price HH, CVD LH) is stronger than ABSORPTION.
  const exhaustionAligns =
    (fundingSide === "LONG" && cvd.futures.divergence === "BEARISH") ||
    (fundingSide === "SHORT" && cvd.futures.divergence === "BULLISH");
  if (exhaustionAligns && cvd.futures.divergenceMechanism === "EXHAUSTION") {
    score += 0.35;
  } else if (exhaustionAligns && cvd.futures.divergenceMechanism === "ABSORPTION") {
    score += 0.2;
  }

  // 2. Spot-futures divergence (0.25)
  //    SUSPECT_BOUNCE when longs paying = leverage-driven rally, no real demand.
  //    SPOT_LEADS when shorts paying = organic buying despite negative funding.
  if (fundingSide === "LONG" && cvd.spotFuturesDivergence === "SUSPECT_BOUNCE") {
    score += 0.25;
  }
  if (fundingSide === "SHORT" && cvd.spotFuturesDivergence === "SPOT_LEADS") {
    score += 0.25;
  }

  // 3. RSI stretched (0.2)
  //    Overbought when longs paying, oversold when shorts paying.
  const rsi = htfCtx.rsi.h4;
  if (fundingSide === "LONG" && rsi > 70) {
    score += 0.2 * Math.min((rsi - 70) / 15, 1);
  } else if (fundingSide === "SHORT" && rsi < 30) {
    score += 0.2 * Math.min((30 - rsi) / 15, 1);
  }

  // 4. OI declining while funding elevated (0.2)
  //    Positions unwinding = participants exiting despite high cost.
  if (signals.oiChange24h < -0.02 || signals.oiChange7d < -0.05) {
    score += 0.2;
  }

  return Math.min(score, 1);
}

/**
 * Phase-based funding score: blends trend-following (early) with
 * mean-reversion (late / exhausted). Returns -100..+100 (LONG-biased).
 */
function scoreFunding(signals: AnalysisSignals, htfCtx?: HtfContext): number {
  const fp = signals.fundingPct1m;
  const cycles = signals.fundingPressureCycles;
  const side = signals.fundingPressureSide;

  // Exhaustion from HTF momentum (0..1)
  const exhaustion = htfCtx ? computeExhaustion(htfCtx, signals, side) : 0;

  // Phase-based blending: trendWeight decays from 1.0 (pure trend-following)
  // toward 0.0 (pure mean-reversion). Exhaustion accelerates the decay.
  const effectiveCycles = cycles + exhaustion * FUNDING_EXHAUSTION_ACCEL;
  const trendWeight = Math.exp(-Math.max(effectiveCycles - 1, 0) / FUNDING_DECAY_TAU);

  // Mean-reversion score: high pctl = bearish (negative), low pctl = bullish (positive).
  const fpDeviation = fp - 50;
  const fpScaled = Math.sign(fpDeviation) * Math.max(Math.abs(fpDeviation) - FUNDING_DEAD_ZONE, 0);
  const meanRevScore = -100 * Math.tanh(fpScaled / 12);

  // Trend-following score: OPPOSITE sign — high funding = bullish early in trend.
  // Only fires when in a genuine extreme (side !== null).
  const trendScore = side !== null ? -meanRevScore : 0;

  return clamp(trendWeight * trendScore + (1 - trendWeight) * meanRevScore, -100, 100);
}

function scoreDerivatives(ctx: DerivativesContext, direction: Direction, htfCtx?: HtfContext): number {
  if (direction === "FLAT") return 0;

  const { positioning, stress, signals } = ctx;

  // 1. Positioning — CROWDED states spike (60-100), continuous OI baseline otherwise.
  //    OI z-score: depressed OI (negative z) = washed positioning = bullish setup,
  //    elevated OI (positive z) = speculative excess = bearish pressure.
  let posScore = 0;
  switch (positioning.state) {
    case "CROWDED_SHORT": {
      const fundingDepth = clamp((20 - signals.fundingPct1m) / 20, 0, 1);
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1);
      posScore = 60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4); // 60–100
      break;
    }
    case "CROWDED_LONG": {
      const fundingDepth = clamp((signals.fundingPct1m - 80) / 20, 0, 1);
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1);
      posScore = -(60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4)); // -60 to -100
      break;
    }
    default: {
      // OI baseline with dead zone: |z| < 1.5 → 0 (normal range, no signal).
      // Only z beyond ±1.5 produces score: z=-3 → +40, z=+3 → -40.
      const z = signals.oiZScore30d;
      const extremeZ = Math.sign(-z) * Math.max(Math.abs(z) - 1.5, 0);
      posScore = clamp(extremeZ / 1.5, -1, 1) * 40;
    }
  }

  // 2. Stress — CAPITULATION/UNWINDING spike, continuous liq + OI change baseline.
  //    All stress signals are LONG-biased (forced selling = buy opportunity).
  let stressScore = 0;
  switch (stress.state) {
    case "CAPITULATION": {
      const liqIntensity = clamp((signals.liqPct3m - 90) / 10, 0, 1);
      const oiDrop = clamp((-signals.oiChange24h - 0.1) / 0.1, 0, 1);
      stressScore = 70 + 30 * (liqIntensity * 0.5 + oiDrop * 0.5); // 70–100
      break;
    }
    case "UNWINDING": {
      const liqIntensity = clamp((signals.liqPct1m - 70) / 30, 0, 1);
      const oiDrop = clamp((-signals.oiChange24h - 0.05) / 0.1, 0, 1);
      stressScore = 40 + 40 * (liqIntensity * 0.5 + oiDrop * 0.5); // 40–80
      break;
    }
    default: {
      // Baseline with dead zones — only extreme liquidation/deleveraging scores.
      // liqPct1m > 70 = elevated liquidations = bullish (forced sellers). Below 70 → 0.
      const liqBase = clamp((signals.liqPct1m - 70) / 30, 0, 1) * 25; // 0..+25
      // oiChange24h beyond ±5% = meaningful deleveraging/leveraging. Inside → 0.
      const oiAbs = Math.abs(signals.oiChange24h);
      const oiExtreme = Math.sign(-signals.oiChange24h) * Math.max(oiAbs - 0.05, 0);
      const oiChangeBase = clamp(oiExtreme / 0.08, -1, 1) * 20; // -20..+20
      stressScore = liqBase + oiChangeBase;
    }
  }

  // 3. Funding — trend-phase-aware scoring.
  //    Fresh flip to extreme funding = trend confirmation (crowd is right early).
  //    As cycles accumulate or exhaustion signals fire, decays toward mean-reversion.
  //    Phase 1 (cycles 1-3): trend-following — high funding = bullish
  //    Phase 2 (cycles 4-8): decaying conviction
  //    Phase 3 (cycles 8+ or exhaustion): mean-reversion — high funding = bearish
  const fundingScore = scoreFunding(signals, htfCtx);

  // 4. Coinbase premium — institutional demand proxy with dead zone.
  //    Positive premium = US buying > offshore = bullish.
  //    Dead zone: pctl 35-65 → ~0. Only extreme premium imbalances score.
  const cbPctl = ctx.coinbasePremium.percentile["1m"];
  const cbDeviation = cbPctl - 50;
  const cbDeadZone = 15;
  const cbScaled = Math.sign(cbDeviation) * Math.max(Math.abs(cbDeviation) - cbDeadZone, 0);
  const cbScore = 100 * Math.tanh(cbScaled / 15);

  const rawScore =
    posScore * DERIV_W_POSITIONING +
    stressScore * DERIV_W_STRESS +
    fundingScore * DERIV_W_FUNDING +
    cbScore * DERIV_W_CBPREMIUM;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── ETFs (-100 to +100) ────────────────────────────────────────────────────
// Institutional flows:
//   - Flow sigma is the strongest signal — a high σ inflow during an outflow
//     regime = institutional reversal, very high probability
//   - Streak reversal: first inflow days after a long outflow streak = confirmation
//   - Streak exhaustion: long streaks increase reversal probability (contrarian)
//   - Regime gives base direction
//   - Reversal ratio measures conviction of the reversal

const ETF_W_SIGMA = 0.35;
const ETF_W_REVERSAL_CONFIRM = 0.3;
const ETF_W_REVERSAL = 0.2;
const ETF_W_REGIME = 0.15;

/**
 * Minimum prior-streak magnitude (in multiples of sigma30d) to consider
 * the streak significant enough for a reversal confirmation signal.
 * A prior streak of 3σ+ cumulative flow is meaningful.
 */
const MIN_PRIOR_STREAK_SIGMAS = 3;

function scoreEtfs(ctx: EtfContext, direction: Direction): number {
  if (direction === "FLAT") return 0;

  const { regime, previousRegime, flow } = ctx;

  // 1. Flow sigma — strongest signal. σ > 2 is very significant.
  //    Positive sigma = inflow day, negative sigma = outflow day.
  //    Raw score is LONG-biased (positive sigma = agrees with LONG).
  //    Extra bonus when sigma contradicts the prevailing regime (reversal signal).
  let sigmaScore = clamp(flow.todaySigma * 50, -100, 100);

  // Regime-contradiction bonus: outflow regime + high positive sigma = reversal
  const regimeContradicts =
    (flow.todaySigma > 1 && (regime === "STRONG_OUTFLOW" || previousRegime === "STRONG_OUTFLOW")) ||
    (flow.todaySigma < -1 && (regime === "STRONG_INFLOW" || previousRegime === "STRONG_INFLOW"));
  if (regimeContradicts) {
    sigmaScore = clamp(sigmaScore * 1.5, -100, 100);
  }

  // 2. Streak reversal confirmation — first 2+ inflow days after a significant
  //    outflow streak (or vice versa). The streak exhaustion signal (below) fires
  //    DURING the streak; this fires at the INFLECTION when direction flips.
  //    Quality scales with the magnitude of the prior streak.
  let reversalConfirmScore = 0;
  const priorMag = Math.abs(flow.priorStreakFlow);
  const priorSignificant = flow.sigma30d > 0 && priorMag / flow.sigma30d >= MIN_PRIOR_STREAK_SIGMAS;

  if (flow.consecutiveInflowDays >= 2 && flow.priorStreakFlow < 0 && priorSignificant) {
    // Inflows after significant outflow streak → LONG confirmation
    const strength = clamp(priorMag / flow.sigma30d / 10, 0.5, 1); // 3σ→0.5, 10σ+→1.0
    reversalConfirmScore = 80 * strength;
  } else if (flow.consecutiveOutflowDays >= 2 && flow.priorStreakFlow > 0 && priorSignificant) {
    // Outflows after significant inflow streak → SHORT confirmation
    const strength = clamp(priorMag / flow.sigma30d / 10, 0.5, 1);
    reversalConfirmScore = -80 * strength;
  }

  // Streak exhaustion removed: fires mid-streak (day 3 of outflows), weak and
  // pre-confirmation — streaks last much longer than expected.

  // 3. Regime — only REVERSAL_TO_* states are reversal signals.
  //    STRONG_INFLOW/STRONG_OUTFLOW are trend-following, not reversal.
  let regimeScore = 0;
  switch (regime) {
    case "REVERSAL_TO_INFLOW":
      regimeScore = 60;
      break;
    case "REVERSAL_TO_OUTFLOW":
      regimeScore = -60;
      break;
    default:
      regimeScore = 0; // NEUTRAL, MIXED, STRONG_INFLOW, STRONG_OUTFLOW
  }

  // 4. Reversal ratio — how much of the prior streak has been reversed.
  //    High ratio during a reversal regime = strong conviction.
  let reversalScore = 0;
  if (regime === "REVERSAL_TO_INFLOW" || regime === "REVERSAL_TO_OUTFLOW") {
    const ratio = Math.min(flow.reversalRatio, 1.5);
    const base = (ratio / 1.5) * 100;
    reversalScore = regime === "REVERSAL_TO_INFLOW" ? base : -base;
  }

  const rawScore =
    sigmaScore * ETF_W_SIGMA +
    reversalConfirmScore * ETF_W_REVERSAL_CONFIRM +
    reversalScore * ETF_W_REVERSAL +
    regimeScore * ETF_W_REGIME;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── HTF (-100 to +100) ─────────────────────────────────────────────────────
// Mean-reversion technical setup:
//   - RSI confidence is the primary driver (how stretched the market is)
//   - CVD divergence confirms the reversal thesis
//   - Volatility compression ("coiled spring") amplifies conviction —
//     after a big move, ATR decays, then the next big move fires
//   - Regime and market structure are complementary, not primary

// Reads pre-computed bias scores from the analyzer (see HtfBias in htf/types.ts).
// The analyzer computes direction-independent component scores once; here we just
// scale to -100..+100 and flip for SHORT.

function scoreHtf(ctx: HtfContext, direction: Direction): number {
  if (direction === "FLAT") {
    // FLAT scoring: low directional bias + low compression = supports flat
    let flatScore = 0;
    if (ctx.regime === "RANGING") flatScore += 30;
    // Low absolute composite = no directional stretch
    flatScore += (1 - Math.abs(ctx.bias.composite)) * 30;
    // No CVD divergence supports flat
    if (ctx.cvd.futures.divergence === "NONE") flatScore += 20;
    // High compression = breakout imminent, penalize flat
    if (ctx.bias.compression > 0.5) flatScore -= 20;
    else if (ctx.bias.compression < 0.2) flatScore += 20;
    // Price inside Value Area + thick POC = range-bound thesis
    if (ctx.volumeProfile?.profile?.pricePosition === "INSIDE_VA" && ctx.volumeProfile.profile.pocVolumePct > 3) {
      flatScore += 25;
    }
    return clamp(flatScore, -100, 100);
  }

  // Scale the composite bias (-1..+1) to conviction (-100..+100).
  // The composite already incorporates compression as an amplifier.
  const rawScore = ctx.bias.composite * 100;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── Exchange Flows (-100 to +100) ───────────────────────────────────────────
// On-chain supply pressure — all magnitude-based:
//   - Reserve change (7d/30d) is the primary signal — continuous, not regime-gated
//   - Flow sigma captures today's intensity
//   - 30d extremes amplify when reserves are at monthly boundaries

const EF_W_RESERVE = 0.65;
const EF_W_EXTREME = 0.35;

function scoreExchangeFlows(ctx: ExchangeFlowsContext, direction: Direction): number {
  if (direction === "FLAT") {
    return ctx.regime === "EF_NEUTRAL" ? 30 : 0;
  }

  const m = ctx.metrics;

  // 1. Reserve change — continuous signal from 7d and 30d reserve movement.
  //    Negative change = reserves shrinking = outflows = bullish.
  //    Scale: -3%+ over 7d is very significant, -0.5% is the FLAT/trend threshold.
  const reserve7d = clamp(-m.reserveChange7dPct / 3, -1, 1) * 100; // -3%→+100, +3%→-100
  const reserve30d = clamp(-m.reserveChange30dPct / 5, -1, 1) * 100; // -5%→+100, +5%→-100
  const reserveScore = reserve7d * 0.6 + reserve30d * 0.4;

  // Flow sigma removed: noisy single-day event, already captured by 7d reserve trend.
  // Balance trend removed: redundant with reserveChange7dPct — same signal counted twice.
  // Exchange-level divergence removed: designed to detect distribution during an up-move,
  // not useful for reversal from a sell-off, and fires -20 to -40 penalty on LONG.

  // 2. 30d extremes — amplified by how far past the prior low/high.
  //    isAt30dLow is binary, but reserveChange30dPct tells us the magnitude.
  let extremeScore = 0;
  if (m.isAt30dLow) {
    extremeScore = 50 + 50 * clamp(-m.reserveChange30dPct / 3, 0, 1); // 50–100
  } else if (m.isAt30dHigh) {
    extremeScore = -(50 + 50 * clamp(m.reserveChange30dPct / 3, 0, 1)); // -50 to -100
  }

  const rawScore = reserveScore * EF_W_RESERVE + extremeScore * EF_W_EXTREME;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Power-curve conviction mapping — amplifies moderate signals.
 * Operates on the internal -100..+100 raw score and returns the same range.
 * Raw 10→22, 20→35, 30→45, 50→63, 70→78, 100→100.
 * Pushes the typical +15-25 range into +28-38 where it becomes meaningful.
 */
function convictionMap(raw: number): number {
  return Math.sign(raw) * 100 * Math.pow(Math.abs(raw) / 100, 0.65);
}

/** 3-decimal rounding for compact JSON storage. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute confluence scores for all dimensions in a given direction.
 *
 * Per-dim values are unweighted normalized scores in -1..+1: each dimension's
 * raw -100..+100 score is passed through the power curve, then divided by 100.
 *
 * The total is the weighted average across dimensions: Σ(score_i × weight_i),
 * where IC-based weights sum to 1 (so total ∈ [-1, +1] regardless of how many
 * dimensions exist).
 *
 * Equal weights (0.25 each by default) are used when calibration data is
 * insufficient.
 */
export function computeConfluence(
  outputs: DimensionOutput[],
  direction: Direction,
  weights: DimensionWeights,
): Confluence {
  const deriv = outputs.find((o) => o.dimension === "DERIVATIVES");
  const etfs = outputs.find((o) => o.dimension === "ETFS");
  const htf = outputs.find((o) => o.dimension === "HTF");
  const ef = outputs.find((o) => o.dimension === "EXCHANGE_FLOWS");

  const htfCtx = htf?.context;

  // Unweighted normalized scores in -1..+1.
  const derivatives = convictionMap(deriv ? scoreDerivatives(deriv.context, direction, htfCtx) : 0) / 100;
  const etfScore = convictionMap(etfs ? scoreEtfs(etfs.context, direction) : 0) / 100;
  const htfScore = convictionMap(htf ? scoreHtf(htf.context, direction) : 0) / 100;
  const exchangeFlows = convictionMap(ef ? scoreExchangeFlows(ef.context, direction) : 0) / 100;

  // Weighted average — weights sum to 1, so total ∈ [-1, +1].
  const total =
    derivatives * weights.derivatives +
    etfScore * weights.etfs +
    htfScore * weights.htf +
    exchangeFlows * weights.exchangeFlows;

  return {
    derivatives: round3(derivatives),
    etfs: round3(etfScore),
    htf: round3(htfScore),
    exchangeFlows: round3(exchangeFlows),
    total: round3(total),
  };
}
