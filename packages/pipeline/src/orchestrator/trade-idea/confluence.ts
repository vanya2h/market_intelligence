/**
 * Confluence Scoring
 *
 * Each dimension produces a conviction score from -100 to +100
 * relative to the trade idea direction:
 *   +100 = maximum agreement (dimension strongly supports direction)
 *   -100 = maximum disagreement (dimension strongly opposes direction)
 *      0 = neutral / no signal
 *
 * Total conviction = sum of all dimensions (-400 to +400).
 * A trade is only taken when total >= CONVICTION_THRESHOLD.
 *
 * For FLAT ideas: scores reflect how strongly the market favors staying
 * rangebound. Positive = supports flat, negative = breakout likely.
 *
 * Sentiment is excluded from scoring — it is a composite of derivatives (50%),
 * ETFs (30%), and HTF (20%), so including it would triple-count those dimensions.
 * It remains valuable as a narrative/context layer for the LLM synthesizer.
 */

import type { DerivativesContext } from "../../types.js";
import type { EtfContext } from "../../etfs/types.js";
import type { HtfContext } from "../../htf/types.js";

import type { ExchangeFlowsContext } from "../../exchange_flows/types.js";
import type { DimensionOutput } from "../types.js";
import type { Direction } from "./composite-target.js";
import type { DimensionWeights } from "./ic-weights.js";

export const CONVICTION_THRESHOLD = 200;

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
// Continuous scoring — every signal contributes, extreme events amplify.
//   - Positioning: CROWDED states spike, OI z-score provides baseline
//   - Stress: CAPITULATION/UNWINDING spike, liq + OI change provide baseline
//   - Funding: sigmoid across full percentile range (no dead zone)
//   - Coinbase premium: institutional demand proxy

// Component weights
const DERIV_W_POSITIONING = 0.3;
const DERIV_W_STRESS = 0.2;
const DERIV_W_FUNDING = 0.3;
const DERIV_W_CBPREMIUM = 0.2;

function scoreDerivatives(ctx: DerivativesContext, direction: Direction): number {
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
      // Continuous OI baseline: z=-2 → +40 (washed), z=+2 → -40 (excess)
      posScore = clamp(-signals.oiZScore30d / 2, -1, 1) * 40;
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
      // Continuous baseline from liquidation intensity + OI change.
      // liqPct1m > 50 = above-average liquidations = bullish (forced sellers).
      // oiChange24h < 0 = deleveraging = bullish.
      const liqBase = clamp((signals.liqPct1m - 50) / 50, -1, 1) * 25; // -25..+25
      const oiChangeBase = clamp(-signals.oiChange24h / 0.08, -1, 1) * 20; // -20..+20
      stressScore = liqBase + oiChangeBase;
    }
  }

  // 3. Funding — sigmoid across full percentile range (no dead zone).
  //    High pct = longs paying = bearish, low pct = shorts paying = bullish.
  //    tanh scaling: 50→0, 30→-46, 70→+46, 20→-76, 80→+76, extremes→±95.
  const fp = signals.fundingPct1m;
  let fundingScore = -100 * Math.tanh((fp - 50) / 20);
  // Amplify by consecutive extreme funding cycles
  if (signals.fundingPressureCycles >= 3) {
    fundingScore *= 1 + clamp((signals.fundingPressureCycles - 3) / 5, 0, 0.5);
  }
  fundingScore = clamp(fundingScore, -100, 100);

  // 4. Coinbase premium — institutional demand proxy.
  //    Positive premium = US buying > offshore = bullish.
  //    Uses percentile for relative context: above 70th = strong demand, below 30th = weak.
  const cbPctl = ctx.coinbasePremium.percentile["1m"];
  const cbScore = 100 * Math.tanh((cbPctl - 50) / 25); // 50→0, 75→+76, 25→-76

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
 * Effective conviction threshold for this setup.
 *
 * ATR compression after a displacement is a high-quality setup:
 * the spring is coiled and an expansion is imminent — directional consensus
 * at 200 is not required because the setup quality compensates for ambiguity
 * in weaker dimensions (e.g. neutral ETF flows, flat derivatives).
 *
 * Threshold scales linearly with compression depth:
 *   ATR at 10th pct → 175   (mild compression)
 *   ATR at 5th pct  → 155   (strong compression)
 *   ATR at 2nd pct  → 130   (extreme — case on 2026-03-28)
 */
export function computeConvictionThreshold(htfCtx: HtfContext): number {
  const { compressionAfterMove, atrPercentile } = htfCtx.volatility;
  if (compressionAfterMove && atrPercentile <= 10) {
    // Linear interpolation: pct=10 → 175, pct=0 → 120
    const depth = (10 - atrPercentile) / 10; // 0 at 10th pct, 1 at 0th pct
    return Math.round(175 - depth * 55); // 175 → 120
  }
  return CONVICTION_THRESHOLD;
}

/**
 * Power-curve conviction mapping — amplifies moderate signals.
 * Raw 10→22, 20→35, 30→45, 50→63, 70→78, 100→100.
 * Pushes the typical +15-25 range into +28-38 where it becomes meaningful.
 */
function convictionMap(raw: number): number {
  return Math.sign(raw) * 100 * Math.pow(Math.abs(raw) / 100, 0.65);
}

/**
 * Compute confluence scores for all dimensions in a given direction.
 *
 * When IC-based weights are provided, each dimension's score is scaled
 * by its weight (derived from historical accuracy / noise ratio).
 * Equal weights (1.0 each) are the default when calibration data is insufficient.
 *
 * The raw score (-100..+100) is first mapped through the power curve,
 * then multiplied by the dimension's weight. With weights summing to 4
 * the total range remains -400..+400, preserving threshold compatibility.
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

  const wDeriv = weights.derivatives;
  const wEtf = weights.etfs;
  const wHtf = weights.htf;
  const wEf = weights.exchangeFlows;

  const derivatives = convictionMap(deriv ? scoreDerivatives(deriv.context, direction) : 0) * wDeriv;
  const etfScore = convictionMap(etfs ? scoreEtfs(etfs.context, direction) : 0) * wEtf;
  const htfScore = convictionMap(htf ? scoreHtf(htf.context, direction) : 0) * wHtf;
  const exchangeFlows = convictionMap(ef ? scoreExchangeFlows(ef.context, direction) : 0) * wEf;

  return {
    derivatives: Math.round(derivatives),
    etfs: Math.round(etfScore),
    htf: Math.round(htfScore),
    exchangeFlows: Math.round(exchangeFlows),
    total: Math.round(derivatives + etfScore + htfScore + exchangeFlows),
  };
}
