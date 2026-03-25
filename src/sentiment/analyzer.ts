/**
 * Market Sentiment — Deterministic Analyzer (Dimension 06)
 *
 * Computes a composite Fear & Greed index (0–100) from five components:
 *
 *   Component           | Weight | Source
 *   ─────────────────────────────────────────────────
 *   Positioning          25%      Dim 01 (derivatives)
 *   Trend                20%      Dim 07 (HTF technicals)
 *   Institutional flows  15%      Dim 03 (ETF flows)
 *   Expert consensus     20%      unbias API
 *   Retail sentiment     10%      Alternative.me F&G
 *   (unimplemented)      10%      reserved for Dim 02/18
 *
 * Regime is determined from the composite score, with divergence overrides.
 */

import {
  SentimentSnapshot,
  SentimentContext,
  SentimentRegime,
  SentimentState,
  SentimentMetrics,
  SentimentEvent,
  FearGreedComponents,
  CrossDimensionInputs,
} from "./types.js";

// ─── Component scoring (each returns 0–100) ─────────────────────────────────

/** Clamp a value to 0–100 */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * Positioning score from derivatives data.
 * High funding + high L/S = greedy (high score). Low/negative = fearful.
 */
function scorePositioning(d: CrossDimensionInputs["derivatives"]): number {
  if (!d) return 50; // neutral fallback

  // Funding percentile directly maps to positioning sentiment
  const fundingScore = d.fundingPercentile1m;

  // L/S ratio: 1.0 = neutral, >2 = greedy, <0.5 = fearful
  // Map to 0–100: ratio 0.3→10, 1.0→50, 2.0→75, 3.0→90
  const lsScore = clamp(((d.longShortRatio - 0.3) / 2.7) * 100);

  // OI percentile — high OI = more leverage = more greed
  const oiScore = d.oiPercentile1m;

  // Regime adjustments
  let regimeBonus = 0;
  if (d.regime === "CROWDED_LONG") regimeBonus = 15;
  else if (d.regime === "CROWDED_SHORT" || d.regime === "CAPITULATION") regimeBonus = -20;
  else if (d.regime === "SHORT_SQUEEZE") regimeBonus = 10;
  else if (d.regime === "DELEVERAGING" || d.regime === "UNWINDING") regimeBonus = -10;

  return clamp(fundingScore * 0.4 + lsScore * 0.25 + oiScore * 0.25 + 50 * 0.1 + regimeBonus);
}

/**
 * Trend score from HTF technicals.
 * Price above SMAs + high RSI + bullish structure = greedy.
 */
function scoreTrend(h: CrossDimensionInputs["htf"]): number {
  if (!h) return 50;

  // Price vs SMA200: -10% → 10, 0% → 50, +10% → 90
  const sma200Score = clamp(50 + h.priceVsSma200Pct * 4);

  // Price vs SMA50: similar but tighter range
  const sma50Score = clamp(50 + h.priceVsSma50Pct * 5);

  // RSI: direct mapping (already 0–100 where >70 = greedy, <30 = fearful)
  const rsiScore = h.dailyRsi;

  // Structure bonus
  let structureScore = 50;
  if (h.structure === "HH_HL") structureScore = 75;
  else if (h.structure === "LH_LL") structureScore = 25;
  else if (h.structure === "HH_LL") structureScore = 55; // expanding, slightly bullish
  else if (h.structure === "LH_HL") structureScore = 45; // contracting

  return clamp(sma200Score * 0.3 + sma50Score * 0.2 + rsiScore * 0.3 + structureScore * 0.2);
}

/**
 * Institutional flows score from ETF data.
 * Sustained inflows = greedy. Sustained outflows = fearful.
 */
function scoreInstitutionalFlows(e: CrossDimensionInputs["etfs"]): number {
  if (!e) return 50;

  // Consecutive days: inflows push toward greed, outflows toward fear
  // 5+ days of inflow → 85, 5+ days of outflow → 15
  let streakScore = 50;
  if (e.consecutiveInflowDays > 0) {
    streakScore = clamp(50 + e.consecutiveInflowDays * 7);
  } else if (e.consecutiveOutflowDays > 0) {
    streakScore = clamp(50 - e.consecutiveOutflowDays * 7);
  }

  // Today's sigma: >2σ inflow = very greedy, <-2σ = very fearful
  const sigmaScore = clamp(50 + e.todaySigma * 15);

  // Regime adjustment
  let regimeBonus = 0;
  if (e.regime === "STRONG_INFLOW") regimeBonus = 10;
  else if (e.regime === "STRONG_OUTFLOW") regimeBonus = -10;
  else if (e.regime === "REVERSAL_TO_INFLOW") regimeBonus = 5;
  else if (e.regime === "REVERSAL_TO_OUTFLOW") regimeBonus = -5;

  return clamp(streakScore * 0.5 + sigmaScore * 0.5 + regimeBonus);
}

/**
 * Expert consensus score from unbias.
 * Consensus index -100 to +100 → map to 0–100.
 * Z-score adds conviction weighting.
 */
function scoreExpertConsensus(consensusIndex: number, zScore: number): number {
  // Base: linear map from [-100,+100] to [0,100]
  const baseScore = (consensusIndex + 100) / 2;

  // Z-score conviction: extreme z-scores push the score further
  let zBonus = 0;
  if (zScore >= 0.8) zBonus = Math.min(10, (zScore - 0.8) * 15);
  else if (zScore <= -1.5) zBonus = Math.max(-10, (zScore + 1.5) * 10);

  return clamp(baseScore + zBonus);
}

// ─── Composite F&G ───────────────────────────────────────────────────────────

const WEIGHTS = {
  positioning: 0.30,
  trend: 0.25,
  institutionalFlows: 0.20,
  expertConsensus: 0.25,
};

function computeComposite(components: FearGreedComponents): number {
  const raw =
    components.positioning * WEIGHTS.positioning +
    components.trend * WEIGHTS.trend +
    components.institutionalFlows * WEIGHTS.institutionalFlows +
    components.expertConsensus * WEIGHTS.expertConsensus;

  return clamp(Math.round(raw * 10) / 10);
}

function compositeLabel(value: number): string {
  if (value < 20) return "Extreme Fear";
  if (value < 40) return "Fear";
  if (value <= 60) return "Neutral";
  if (value <= 80) return "Greed";
  return "Extreme Greed";
}

// ─── Metrics computation ─────────────────────────────────────────────────────

function computeMetrics(snapshot: SentimentSnapshot): SentimentMetrics {
  const latestConsensus = snapshot.consensus.at(0);
  const consensusIndex = latestConsensus?.consensusIndex ?? 0;
  const consensusIndex30dMa = latestConsensus?.consensusIndex30dMa ?? 0;
  const zScore = latestConsensus?.zScore ?? 0;
  const totalAnalysts = latestConsensus?.totalAnalysts ?? 0;
  const bullishRatio = totalAnalysts > 0
    ? (latestConsensus?.bullishAnalysts ?? 0) / totalAnalysts
    : 0.5;

  // Compute component scores
  const cd = snapshot.crossDimensions;
  const components: FearGreedComponents = {
    positioning: scorePositioning(cd.derivatives),
    trend: scoreTrend(cd.htf),
    institutionalFlows: scoreInstitutionalFlows(cd.etfs),
    expertConsensus: scoreExpertConsensus(consensusIndex, zScore),
  };

  const compositeIndex = computeComposite(components);

  // Divergence: experts vs composite
  // If experts are bullish but composite is in fear territory (or vice versa)
  const expertsBullish = zScore >= 0.8;
  const expertsBearish = zScore <= -1.5;
  const compositeFearful = compositeIndex < 30;
  const compositeGreedy = compositeIndex > 70;

  let divergence = false;
  let divergenceType: SentimentMetrics["divergenceType"] = null;

  if (expertsBullish && compositeFearful) {
    divergence = true;
    divergenceType = "experts_bullish_crowd_fearful";
  } else if (expertsBearish && compositeGreedy) {
    divergence = true;
    divergenceType = "experts_bearish_crowd_greedy";
  }

  return {
    compositeIndex,
    compositeLabel: compositeLabel(compositeIndex),
    components,
    consensusIndex,
    consensusIndex30dMa,
    zScore,
    bullishRatio,
    totalAnalysts,
    divergence,
    divergenceType,
  };
}

// ─── State machine ────────────────────────────────────────────────────────────

function determineRegime(metrics: SentimentMetrics): SentimentRegime {
  const { zScore, divergence, compositeIndex } = metrics;

  // Divergence overrides everything — most actionable signal
  if (divergence) return "SENTIMENT_DIVERGENCE";

  // Consensus + composite aligned at extremes
  if (zScore >= 0.8 && compositeIndex > 70) return "CONSENSUS_BULLISH";
  if (zScore <= -1.5 && compositeIndex < 30) return "CONSENSUS_BEARISH";

  // Composite-driven regimes
  if (compositeIndex < 20) return "EXTREME_FEAR";
  if (compositeIndex > 80) return "EXTREME_GREED";
  if (compositeIndex < 40) return "FEAR";
  if (compositeIndex > 60) return "GREED";

  return "NEUTRAL";
}

// ─── Event detection ──────────────────────────────────────────────────────────

function detectEvents(metrics: SentimentMetrics, timestamp: string): SentimentEvent[] {
  const events: SentimentEvent[] = [];

  if (metrics.compositeIndex < 20) {
    events.push({
      type: "extreme_fear",
      detail: `Composite F&G at ${metrics.compositeIndex.toFixed(1)} — extreme fear zone`,
      at: timestamp,
    });
  }

  if (metrics.compositeIndex > 80) {
    events.push({
      type: "extreme_greed",
      detail: `Composite F&G at ${metrics.compositeIndex.toFixed(1)} — extreme greed zone`,
      at: timestamp,
    });
  }

  if (metrics.zScore >= 0.8) {
    events.push({
      type: "consensus_bullish",
      detail: `Analyst consensus z-score at ${metrics.zScore.toFixed(2)} — bullish (${metrics.totalAnalysts} analysts, ${Math.round(metrics.bullishRatio * 100)}% bullish)`,
      at: timestamp,
    });
  }

  if (metrics.zScore <= -1.5) {
    events.push({
      type: "consensus_bearish",
      detail: `Analyst consensus z-score at ${metrics.zScore.toFixed(2)} — bearish (${metrics.totalAnalysts} analysts, ${Math.round((1 - metrics.bullishRatio) * 100)}% bearish)`,
      at: timestamp,
    });
  }

  if (metrics.divergence) {
    const desc = metrics.divergenceType === "experts_bullish_crowd_fearful"
      ? `Experts bullish (z=${metrics.zScore.toFixed(2)}) while composite fearful (${metrics.compositeIndex.toFixed(1)})`
      : `Experts bearish (z=${metrics.zScore.toFixed(2)}) while composite greedy (${metrics.compositeIndex.toFixed(1)})`;
    events.push({
      type: "sentiment_divergence",
      detail: desc,
      at: timestamp,
    });
  }

  return events;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyze(
  snapshot: SentimentSnapshot,
  prevState: SentimentState | null
): { context: SentimentContext; nextState: SentimentState } {
  const metrics = computeMetrics(snapshot);
  const regime = determineRegime(metrics);
  const events = detectEvents(metrics, snapshot.timestamp);

  const since = prevState?.regime === regime ? prevState.since : snapshot.timestamp;
  const now = new Date(snapshot.timestamp);
  const durationDays = Math.max(
    0,
    Math.round((now.getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24))
  );
  const previousRegime =
    prevState?.regime !== regime
      ? (prevState?.regime ?? null)
      : (prevState?.previousRegime ?? null);

  const context: SentimentContext = {
    asset: snapshot.asset,
    regime,
    since,
    durationDays,
    previousRegime,
    metrics,
    events,
  };

  const nextState: SentimentState = {
    asset: snapshot.asset,
    regime,
    since,
    previousRegime,
    lastUpdated: snapshot.timestamp,
  };

  return { context, nextState };
}
