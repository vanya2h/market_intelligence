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
// Swing reversal logic:
//   - Crowded positioning in opposite direction = strong agreement
//   - Stress events (capitulation/unwinding) = mean-reversion (favors LONG)
//   - Funding pressure extremes = crowded side paying premium
//   - OI context amplifies or dampens conviction

// Component weights
const DERIV_W_POSITIONING = 0.4;
const DERIV_W_STRESS = 0.25;
const DERIV_W_FUNDING = 0.35;

function scoreDerivatives(ctx: DerivativesContext, direction: Direction): number {
  if (direction === "FLAT") return 0;

  const { positioning, stress, signals } = ctx;

  // 1. Positioning — magnitude-based using continuous metrics
  let posScore = 0;
  switch (positioning.state) {
    case "CROWDED_SHORT": {
      // Squeeze potential scales with funding extremity + OI pressure.
      // fundingPct1m < 20 for CROWDED_SHORT — lower = more extreme.
      // oiZScore30d > 0.5 = elevated OI = more fuel.
      const fundingDepth = clamp((20 - signals.fundingPct1m) / 20, 0, 1); // 20→0, 0→1
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1); // 0→0, 2+→1
      posScore = 60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4); // 60–100
      break;
    }
    case "CROWDED_LONG": {
      // Mirror of CROWDED_SHORT. fundingPct1m > 80 — higher = more extreme.
      const fundingDepth = clamp((signals.fundingPct1m - 80) / 20, 0, 1); // 80→0, 100→1
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1);
      posScore = -(60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4)); // -60 to -100
      break;
    }
    // HEATING_UP removed: crowd is building but not committed yet — fires during
    // compression and adds directional ambiguity, not reversal signal.
    default:
      posScore = 0;
  }

  // 2. Stress — magnitude-based using liq percentiles + OI drop
  //    All stress states are LONG-biased (forced selling = buy opportunity).
  let stressScore = 0;
  switch (stress.state) {
    case "CAPITULATION": {
      // Scale with liquidation intensity + OI destruction.
      // liqPct3m threshold is 90; higher = more extreme cascade.
      // oiChange24h threshold is -10%; larger drop = more violent.
      const liqIntensity = clamp((signals.liqPct3m - 90) / 10, 0, 1); // 90→0, 100→1
      const oiDrop = clamp((-signals.oiChange24h - 0.10) / 0.10, 0, 1); // -10%→0, -20%+→1
      stressScore = 70 + 30 * (liqIntensity * 0.5 + oiDrop * 0.5); // 70–100
      break;
    }
    case "UNWINDING": {
      // Scale with liq + OI drop magnitude.
      // liqPct1m threshold is 70; oiChange24h threshold is -5%.
      const liqIntensity = clamp((signals.liqPct1m - 70) / 30, 0, 1); // 70→0, 100→1
      const oiDrop = clamp((-signals.oiChange24h - 0.05) / 0.10, 0, 1); // -5%→0, -15%+→1
      stressScore = 40 + 40 * (liqIntensity * 0.5 + oiDrop * 0.5); // 40–80
      break;
    }
    // DELEVERAGING removed: mild 10–30 pt signal, 3+ funding cycles without a
    // real event is noise, not reversal fuel.
    default:
      stressScore = 0;
  }

  // 3. Funding pressure — continuous from percentile extremes
  //    fundingPct1m: >80 = longs paying (bearish), <20 = shorts paying (bullish)
  let fundingScore = 0;
  const fp = signals.fundingPct1m;
  if (fp > 80) {
    fundingScore = -((fp - 80) / 20) * 100; // 80→0, 100→-100
  } else if (fp < 20) {
    fundingScore = ((20 - fp) / 20) * 100; // 20→0, 0→+100
  }
  // Amplify by consecutive extreme funding cycles
  if (signals.fundingPressureCycles >= 3) {
    fundingScore *= 1 + clamp((signals.fundingPressureCycles - 3) / 5, 0, 0.5); // 3→1.0×, 8+→1.5×
  }

  // 4. OI context — continuous from z-score. Amplifies other signals.
  //    High OI (positive z) = more fuel for squeeze.
  //    Depressed OI (negative z) = less conviction, dampen signal.
  const oiZ = signals.oiZScore30d;
  const oiMult = clamp(1 + oiZ * 0.15, 0.7, 1.3); // z=0→1.0, z=2→1.3, z=-2→0.7

  const rawScore =
    posScore * DERIV_W_POSITIONING +
    stressScore * DERIV_W_STRESS +
    clamp(fundingScore, -100, 100) * DERIV_W_FUNDING;

  // Apply OI multiplier and directional flip
  const scaled = rawScore * oiMult;

  return clamp(directional(scaled, direction), -100, 100);
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
const ETF_W_REVERSAL_CONFIRM = 0.30;
const ETF_W_REVERSAL = 0.20;
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
  let sigmaScore = clamp(flow.todaySigma * 35, -100, 100);

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

  const rawScore =
    reserveScore * EF_W_RESERVE +
    extremeScore * EF_W_EXTREME;

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

export function computeConfluence(outputs: DimensionOutput[], direction: Direction): Confluence {
  const deriv = outputs.find((o) => o.dimension === "DERIVATIVES");
  const etfs = outputs.find((o) => o.dimension === "ETFS");
  const htf = outputs.find((o) => o.dimension === "HTF");
  const ef = outputs.find((o) => o.dimension === "EXCHANGE_FLOWS");

  const derivatives = deriv ? scoreDerivatives(deriv.context, direction) : 0;
  const etfScore = etfs ? scoreEtfs(etfs.context, direction) : 0;
  const htfScore = htf ? scoreHtf(htf.context, direction) : 0;
  const exchangeFlows = ef ? scoreExchangeFlows(ef.context, direction) : 0;

  return {
    derivatives: Math.round(derivatives),
    etfs: Math.round(etfScore),
    htf: Math.round(htfScore),
    exchangeFlows: Math.round(exchangeFlows),
    total: Math.round(derivatives + etfScore + htfScore + exchangeFlows),
  };
}
