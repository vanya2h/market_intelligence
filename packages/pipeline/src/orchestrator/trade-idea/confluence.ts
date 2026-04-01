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
 */

import type { DerivativesContext } from "../../types.js";
import type { EtfContext } from "../../etfs/types.js";
import type { HtfContext } from "../../htf/types.js";
import type { SentimentContext } from "../../sentiment/types.js";
import type { ExchangeFlowsContext } from "../../exchange_flows/types.js";
import type { DimensionOutput } from "../types.js";
import type { Direction } from "./composite-target.js";

export const CONVICTION_THRESHOLD = 200;

export interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  sentiment: number;
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
    case "HEATING_UP": {
      // Scale by how deep into the heating zone.
      // fundingPct1m 40–70: 55 is center (mildest), edges are more significant.
      // oiChange7d: 2% is threshold, higher = more heated.
      // fundingPressureSide tells us WHO is paying.
      const fpDist = Math.abs(signals.fundingPct1m - 55) / 15; // 0 at center, 1 at edges
      const oiHeat = clamp((signals.oiChange7d - 0.02) / 0.08, 0, 1); // 2%→0, 10%+→1
      const heatMagnitude = (fpDist * 0.4 + oiHeat * 0.6) * 70; // max 70
      posScore = signals.fundingPressureSide === "SHORT" ? heatMagnitude : -heatMagnitude;
      break;
    }
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
    case "DELEVERAGING": {
      // Mild — scale with funding pressure cycle count.
      // Threshold is 3 cycles; more cycles = more sustained.
      const cycleDepth = clamp((signals.fundingPressureCycles - 3) / 5, 0, 1); // 3→0, 8+→1
      stressScore = 10 + 20 * cycleDepth; // 10–30
      break;
    }
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
const ETF_W_REVERSAL_CONFIRM = 0.25;
const ETF_W_STREAK = 0.15;
const ETF_W_REGIME = 0.15;
const ETF_W_REVERSAL = 0.1;

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

  // 3. Streak exhaustion — longer streaks in one direction increase reversal probability.
  //    This is a contrarian signal: long outflow streak = more likely to reverse to inflow = LONG.
  let streakScore = 0;
  if (flow.consecutiveOutflowDays >= 3) {
    // Outflow exhaustion → favors LONG reversal. Exponential scaling.
    streakScore = clamp(Math.pow(flow.consecutiveOutflowDays, 1.3) * 8, 0, 100);
  } else if (flow.consecutiveInflowDays >= 3) {
    // Inflow exhaustion → favors SHORT reversal
    streakScore = -clamp(Math.pow(flow.consecutiveInflowDays, 1.3) * 8, 0, 100);
  }

  // 4. Regime base score
  let regimeScore = 0;
  switch (regime) {
    case "STRONG_INFLOW":
      regimeScore = 80;
      break;
    case "REVERSAL_TO_INFLOW":
      regimeScore = 60;
      break;
    case "REVERSAL_TO_OUTFLOW":
      regimeScore = -60;
      break;
    case "STRONG_OUTFLOW":
      regimeScore = -80;
      break;
    default:
      regimeScore = 0; // NEUTRAL, MIXED
  }

  // 5. Reversal ratio — how much of the prior streak has been reversed.
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
    streakScore * ETF_W_STREAK +
    regimeScore * ETF_W_REGIME +
    reversalScore * ETF_W_REVERSAL;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── HTF (-100 to +100) ─────────────────────────────────────────────────────
// Mean-reversion technical setup:
//   - RSI confidence is the primary driver (how stretched the market is)
//   - CVD divergence confirms the reversal thesis
//   - Volatility compression ("coiled spring") amplifies conviction —
//     after a big move, ATR decays, then the next big move fires
//   - Regime and market structure are complementary, not primary

const HTF_W_RSI = 0.25;
const HTF_W_CVD = 0.25;
const HTF_W_VOLATILITY = 0.15;
const HTF_W_VP = 0.2;
const HTF_W_REGIME = 0.1;
const HTF_W_STRUCTURE = 0.05;

function scoreHtf(ctx: HtfContext, direction: Direction): number {
  if (direction === "FLAT") {
    // For FLAT: RANGING regime + RSI near 50 + no CVD divergence = supports flat
    let flatScore = 0;
    if (ctx.regime === "RANGING") flatScore += 30;
    // RSI near 50 = no directional stretch = supports flat
    const rsiNeutral = 1 - Math.abs(ctx.rsi.h4 - 50) / 50; // 0-1, 1 when RSI=50
    flatScore += rsiNeutral * 30;
    // No CVD divergence supports flat
    if (ctx.cvd.futures.divergence === "NONE") flatScore += 20;
    // High ATR = not flat, penalize. Low ATR without displacement = genuinely quiet.
    if (ctx.volatility.atrPercentile > 70) flatScore -= 20;
    else if (ctx.volatility.atrPercentile < 30 && !ctx.volatility.compressionAfterMove) flatScore += 20;
    // Price inside Value Area + thick POC = range-bound thesis
    if (ctx.volumeProfile.profile.pricePosition === "INSIDE_VA" && ctx.volumeProfile.profile.pocVolumePct > 3) {
      flatScore += 25;
    }
    return clamp(flatScore, -100, 100);
  }

  // 1. RSI confidence — distance from 50.
  //    For LONG: oversold (RSI < 50) = positive. RSI=20 → strong LONG signal.
  //    For SHORT: overbought (RSI > 50) = positive. RSI=80 → strong SHORT signal.
  //    Use 4h RSI for entry-level signal, daily RSI for trend confirmation.
  const rsiDeviation4h = (50 - ctx.rsi.h4) / 50; // positive when oversold (LONG-biased)
  const rsiDeviationDaily = (50 - ctx.rsi.daily) / 50;
  const rsiRaw = (rsiDeviation4h * 0.7 + rsiDeviationDaily * 0.3) * 100;

  // 2. CVD divergence — magnitude-based using slope, R², mechanism, and spot/futures alignment
  let cvdScore = 0;
  const { futures, spot, spotFuturesDivergence } = ctx.cvd;

  // Futures CVD: slope magnitude scales the base, R² scales confidence
  if (futures.divergence !== "NONE") {
    const sign = futures.divergence === "BULLISH" ? 1 : -1;
    const slopeMag = clamp(Math.abs(futures.short.slope) / 0.5, 0.3, 1.0);
    const mechMult = futures.divergenceMechanism === "ABSORPTION" ? 1.25
      : futures.divergenceMechanism === "EXHAUSTION" ? 0.75 : 1.0;
    const r2Conf = 0.4 + futures.short.r2 * 0.6;
    cvdScore += sign * 60 * slopeMag * mechMult * r2Conf;
  }

  // Spot CVD: same pattern, lower base
  if (spot.divergence !== "NONE") {
    const sign = spot.divergence === "BULLISH" ? 1 : -1;
    const slopeMag = clamp(Math.abs(spot.short.slope) / 0.5, 0.3, 1.0);
    const r2Conf = 0.4 + spot.short.r2 * 0.6;
    cvdScore += sign * 40 * slopeMag * r2Conf;
  }

  // Spot-futures alignment modifier — suspect bounces get heavily discounted
  const alignmentMult =
    spotFuturesDivergence === "CONFIRMED_BUYING" || spotFuturesDivergence === "CONFIRMED_SELLING" ? 1.0
    : spotFuturesDivergence === "SPOT_LEADS" ? 0.85
    : spotFuturesDivergence === "SUSPECT_BOUNCE" ? 0.6
    : 0.75;
  cvdScore *= alignmentMult;

  // 3. Volatility compression — "coiled spring" after big move.
  //    Doesn't pick direction, but amplifies directional conviction.
  //    compressionAfterMove = ATR compressed (bottom 30th pctl) + recent big displacement.
  //    When the spring is coiled, the next directional move is high-probability.
  let volScore = 0;
  const vol = ctx.volatility;
  if (vol.compressionAfterMove) {
    // Strong coiled spring — big boost in the direction other signals point
    // Scale by how compressed (lower percentile = tighter spring)
    const compressionStrength = (30 - vol.atrPercentile) / 30; // 0-1
    // Scale by displacement magnitude (bigger prior move = more energy stored)
    const displacementStrength = clamp((vol.recentDisplacement - 2) / 3, 0, 1); // 2-5 ATR → 0-1
    volScore = 100 * (0.5 + compressionStrength * 0.25 + displacementStrength * 0.25);
  } else if (vol.atrRatio < 0.7) {
    // Moderate compression without confirmed displacement — still worth something
    volScore = 40 * ((0.7 - vol.atrRatio) / 0.3); // 0-40 as ratio drops from 0.7 to 0.4
  } else if (vol.atrPercentile > 80) {
    // High volatility — move is already happening, less edge for new entry
    volScore = -30;
  }
  // volScore is unsigned (conviction amplifier) — signs it in the direction of other signals
  const otherSignalDir = rsiRaw + cvdScore;
  if (otherSignalDir < 0) volScore = -Math.abs(volScore);

  // 4. Regime — continuous from MA position + RSI extremity
  //    Price vs 200 SMA drives macro direction; RSI extremes add contrarian signal.
  let regimeScore = clamp(ctx.ma.priceVsSma200Pct / 10, -1, 1) * 50; // -50 to +50

  // Reclaiming bonus: price between SMA50 and SMA200, scaling with progress toward 200
  if (ctx.ma.priceVsSma200Pct < 0 && ctx.ma.priceVsSma50Pct > 0) {
    const reclaimProgress = clamp(ctx.ma.priceVsSma50Pct / (-ctx.ma.priceVsSma200Pct + ctx.ma.priceVsSma50Pct), 0, 1);
    regimeScore += reclaimProgress * 20;
  }

  // Extended contrarian: deep overbought/oversold adds mean-reversion signal
  if (ctx.rsi.daily > 70) {
    regimeScore -= ((ctx.rsi.daily - 70) / 30) * 40; // up to -40 contrarian
  } else if (ctx.rsi.daily < 30) {
    regimeScore += ((30 - ctx.rsi.daily) / 30) * 40; // up to +40 contrarian
  }
  regimeScore = clamp(regimeScore, -100, 100);

  // 5. Market structure — scaled by pivot recency (fresh pivots = stronger signal)
  const structureBase =
    ctx.structure === "HH_HL" ? 50
    : ctx.structure === "LH_LL" ? -50
    : ctx.structure === "HH_LL" ? 10
    : ctx.structure === "LH_HL" ? -10
    : 0;
  const pivotFreshness = ctx.staleness.lastPivot != null
    ? clamp(1 - ctx.staleness.lastPivot / 50, 0.3, 1.0) // fades over ~8 days, floor 0.3
    : 0.5;
  const structureScore = structureBase * pivotFreshness;

  // 6. Volume Profile — continuous distance from POC (mean-reversion magnet)
  //    Below POC = bullish pull, above POC = bearish pull. Scales with distance.
  //    Confidence scaled by POC thickness (pocVolumePct / 5, clamped 0.5–1.5)
  let vpScore = 0;
  if (ctx.volumeProfile) {
    const vp = ctx.volumeProfile.profile;
    // priceVsPocPct: negative = below POC (bullish), positive = above (bearish)
    const vpRaw = clamp(-vp.priceVsPocPct / 10, -1, 1) * 70; // -70 to +70
    vpScore = vpRaw * clamp(vp.pocVolumePct / 5, 0.5, 1.5);
  }

  // 7. Sweep proximity — price near a high-attraction sweep level = directional nudge
  //    Price being pulled toward the level to sweep accumulated liquidity.
  //    Fixed ±15 bonus (not weighted) — small but meaningful tiebreaker.
  let sweepBonus = 0;
  if (ctx.sweep) {
    const { nearestHigh, nearestLow } = ctx.sweep;
    const atrDist = 1.5 * ctx.atr;
    if (nearestHigh && (nearestHigh.price - ctx.price) < atrDist && nearestHigh.attraction > 2) {
      sweepBonus += 15; // LONG bias — price pulled up to sweep the high
    }
    if (nearestLow && (ctx.price - nearestLow.price) < atrDist && nearestLow.attraction > 2) {
      sweepBonus -= 15; // SHORT bias — price pulled down to sweep the low
    }
  }

  const rawScore =
    rsiRaw * HTF_W_RSI +
    clamp(cvdScore, -100, 100) * HTF_W_CVD +
    clamp(volScore, -100, 100) * HTF_W_VOLATILITY +
    clamp(vpScore, -100, 100) * HTF_W_VP +
    regimeScore * HTF_W_REGIME +
    structureScore * HTF_W_STRUCTURE +
    sweepBonus;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── Sentiment (-100 to +100) ───────────────────────────────────────────────
// Contrarian crowd signal:
//   - Composite F&G extremes: extreme fear → LONG, extreme greed → SHORT
//   - Component convergence: all components agreeing = stronger signal
// Expert consensus excluded (disabled for now)

const SENT_W_COMPOSITE = 0.55;
const SENT_W_REGIME = 0.2;
const SENT_W_CONVERGENCE = 0.25;

function scoreSentiment(ctx: SentimentContext, direction: Direction): number {
  if (direction === "FLAT") {
    // Neutral sentiment = supports flat
    const neutrality = 1 - Math.abs(ctx.metrics.compositeIndex - 50) / 50;
    return clamp(neutrality * 60, -100, 100);
  }

  // 1. Composite F&G — contrarian, but only at extremes.
  //    Mild fear/greed (20–80) is noise for swing trading — only act on extremes.
  //    Fear (< 20) agrees with LONG (buy when others are fearful).
  //    Greed (> 80) agrees with SHORT (sell when others are greedy).
  const fg = ctx.metrics.compositeIndex;
  let boostedComposite = 0;
  if (fg <= 20) {
    // Extreme fear: 20→0 maps to 0→+100
    boostedComposite = ((20 - fg) / 20) * 100;
  } else if (fg >= 80) {
    // Extreme greed: 80→100 maps to 0→-100
    boostedComposite = -((fg - 80) / 20) * 100;
  }

  // 2. Regime base — only extremes generate signal, scaled by depth.
  //    F&G 20→0 maps to regimeScore 0→+100 (fear = LONG).
  //    F&G 80→100 maps to regimeScore 0→-100 (greed = SHORT).
  let regimeScore = 0;
  if (fg <= 20) {
    regimeScore = ((20 - fg) / 20) * 100;
  } else if (fg >= 80) {
    regimeScore = -((fg - 80) / 20) * 100;
  }

  // 3. Component convergence — how many F&G components agree on direction.
  //    When 4+ components cluster in fear or greed territory, signal is stronger.
  const components = ctx.metrics.components;
  const componentValues = [
    components.positioning,
    components.trend,
    components.institutionalFlows,
    // momentumDivergence, exchangeFlows, expertConsensus excluded — not reliable for trade ideas
  ];

  const fearCount = componentValues.filter((v) => v < 40).length;
  const greedCount = componentValues.filter((v) => v > 60).length;
  const maxConvergence = Math.max(fearCount, greedCount);
  // 0-3 components converging → 0-100 score
  const convergenceRaw = (maxConvergence / 3) * 100;
  // Sign: positive if fear-converging (LONG), negative if greed-converging (SHORT)
  const convergenceScore = fearCount > greedCount ? convergenceRaw : -convergenceRaw;

  const rawScore =
    clamp(boostedComposite, -100, 100) * SENT_W_COMPOSITE +
    regimeScore * SENT_W_REGIME +
    convergenceScore * SENT_W_CONVERGENCE;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── Exchange Flows (-100 to +100) ───────────────────────────────────────────
// On-chain supply pressure — all magnitude-based:
//   - Reserve change (7d/30d) is the primary signal — continuous, not regime-gated
//   - Flow sigma captures today's intensity
//   - 30d extremes amplify when reserves are at monthly boundaries

const EF_W_RESERVE = 0.35;
const EF_W_SIGMA = 0.30;
const EF_W_TREND = 0.20;
const EF_W_EXTREME = 0.15;

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

  // 2. Flow sigma — today's flow intensity relative to 30d distribution.
  //    Negative sigma = outflow day (bullish), positive = inflow day (bearish).
  const sigmaScore = clamp(-m.todaySigma * 30, -100, 100);

  // 3. Balance trend — scaled by 7d reserve change magnitude instead of flat ±60.
  //    FALLING with -2% is stronger than FALLING with -0.6%.
  let trendScore = 0;
  if (m.balanceTrend === "FALLING") {
    trendScore = 30 + 40 * clamp(-m.reserveChange7dPct / 2, 0, 1); // 30–70, scaled by magnitude
  } else if (m.balanceTrend === "RISING") {
    trendScore = -(30 + 40 * clamp(m.reserveChange7dPct / 2, 0, 1)); // -30 to -70
  }

  // 4. 30d extremes — amplified by how far past the prior low/high.
  //    isAt30dLow is binary, but reserveChange30dPct tells us the magnitude.
  let extremeScore = 0;
  if (m.isAt30dLow) {
    extremeScore = 50 + 50 * clamp(-m.reserveChange30dPct / 3, 0, 1); // 50–100
  } else if (m.isAt30dHigh) {
    extremeScore = -(50 + 50 * clamp(m.reserveChange30dPct / 3, 0, 1)); // -50 to -100
  }

  const rawScore =
    reserveScore * EF_W_RESERVE +
    sigmaScore * EF_W_SIGMA +
    trendScore * EF_W_TREND +
    extremeScore * EF_W_EXTREME;

  return clamp(directional(rawScore, direction), -100, 100);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeConfluence(outputs: DimensionOutput[], direction: Direction): Confluence {
  const deriv = outputs.find((o) => o.dimension === "DERIVATIVES");
  const etfs = outputs.find((o) => o.dimension === "ETFS");
  const htf = outputs.find((o) => o.dimension === "HTF");
  const sent = outputs.find((o) => o.dimension === "SENTIMENT");
  const ef = outputs.find((o) => o.dimension === "EXCHANGE_FLOWS");

  const derivatives = deriv ? scoreDerivatives(deriv.context, direction) : 0;
  const etfScore = etfs ? scoreEtfs(etfs.context, direction) : 0;
  const htfScore = htf ? scoreHtf(htf.context, direction) : 0;
  const sentiment = sent ? scoreSentiment(sent.context, direction) : 0;
  const exchangeFlows = ef ? scoreExchangeFlows(ef.context, direction) : 0;

  return {
    derivatives: Math.round(derivatives),
    etfs: Math.round(etfScore),
    htf: Math.round(htfScore),
    sentiment: Math.round(sentiment),
    exchangeFlows: Math.round(exchangeFlows),
    total: Math.round(derivatives + etfScore + htfScore + sentiment + exchangeFlows),
  };
}
