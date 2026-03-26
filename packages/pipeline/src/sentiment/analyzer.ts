/**
 * Market Sentiment — Deterministic Analyzer (Dimension 06)
 *
 * Computes a composite Fear & Greed index (0–100) from three active components
 * (expert consensus temporarily disabled while collecting delta-based data):
 *
 *   Component           | Weight | Source
 *   ─────────────────────────────────────────────────
 *   Positioning          40%      Dim 01 (derivatives: funding, OI,
 *                                   coinbase premium, bias-adjusted liqs)
 *   Trend                30%      Dim 07 (HTF technicals)
 *   Institutional flows  30%      Dim 03 (ETF flows)
 *   Expert consensus      0%      unbias API 7d delta (collecting data, re-enable ~2026-04-02)
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
  UnbiasConsensusEntry,
} from "./types.js";

// ─── Component scoring (each returns 0–100) ─────────────────────────────────

/** Clamp a value to 0–100 */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * Positioning score from derivatives data.
 *
 * Weights:
 *   Funding          35%  — leverage cost, directional bias
 *   Coinbase premium 25%  — real spot demand vs derivatives-only rally
 *   OI               25%  — leverage buildup
 *   Liquidations     15%  — bias-adjusted: long-dominant liqs reduce score,
 *                           short-dominant liqs increase it
 */
function scorePositioning(d: CrossDimensionInputs["derivatives"]): number {
  if (!d) return 50; // neutral fallback

  // Liquidation score adjusted by bias direction:
  // liqLongPct=100 (all longs liquidated) → invert percentile (bearish)
  // liqLongPct=0   (all shorts liquidated) → keep percentile (bullish/squeeze)
  // liqLongPct=50  (balanced) → neutral (50)
  // Formula: interpolate between inverted and raw percentile based on bias
  const longBias = d.liqLongPct / 100; // 0–1
  const liqBearish = 100 - d.liqPercentile1m; // high liqs + longs = fearful
  const liqBullish = d.liqPercentile1m;        // high liqs + shorts = greedy
  const liqScore = liqBullish * (1 - longBias) + liqBearish * longBias;

  const raw =
    d.fundingPercentile1m * 0.35 +
    d.cbPremiumPercentile1m * 0.25 +
    d.oiPercentile1m * 0.25 +
    liqScore * 0.15;

  // Regime adjustments
  let regimeBonus = 0;
  if (d.regime === "CROWDED_LONG") regimeBonus = 10;
  else if (d.regime === "CROWDED_SHORT" || d.regime === "CAPITULATION") regimeBonus = -15;
  else if (d.regime === "SHORT_SQUEEZE") regimeBonus = 8;
  else if (d.regime === "DELEVERAGING" || d.regime === "UNWINDING") regimeBonus = -8;

  return clamp(raw + regimeBonus);
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
 * Expert consensus score from unbias — delta-based.
 *
 * The absolute consensus level is a lagging, long-timeframe indicator
 * (analysts' votes persist up to 30 days, z-score is 90-day rolling).
 * Instead we score the week-over-week *change* in consensus index,
 * which captures when sentiment is actively shifting.
 *
 * Delta mapping (absolute points on the -100/+100 scale):
 *   -20 pts/week → 0 (strong fear shift)
 *     0 pts/week → 50 (neutral / unchanged)
 *   +20 pts/week → 100 (strong greed shift)
 */
function scoreExpertConsensus(consensus: UnbiasConsensusEntry[]): {
  score: number;
  delta: number;
} {
  if (consensus.length < 2) {
    return { score: 50, delta: 0 };
  }

  // consensus is sorted newest-first; oldest entry is the baseline
  const latest = consensus[0]!;
  const oldest = consensus[consensus.length - 1]!;
  const delta = latest.consensusIndex - oldest.consensusIndex;

  // Map delta [-20, +20] → [0, 100], clamped
  const score = clamp(50 + delta * 2.5);

  return { score, delta };
}

// ─── Composite F&G ───────────────────────────────────────────────────────────

// Expert consensus temporarily excluded while we collect delta-based data (re-enable ~2026-04-02)
const WEIGHTS = {
  positioning: 0.40,
  trend: 0.30,
  institutionalFlows: 0.30,
  expertConsensus: 0,
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
  const expert = scoreExpertConsensus(snapshot.consensus);
  const components: FearGreedComponents = {
    positioning: scorePositioning(cd.derivatives),
    trend: scoreTrend(cd.htf),
    institutionalFlows: scoreInstitutionalFlows(cd.etfs),
    expertConsensus: expert.score,
  };

  const compositeIndex = computeComposite(components);

  // Divergence: expert consensus momentum vs composite level
  // Uses delta (momentum) rather than absolute z-score to avoid stale signals
  const expertsShiftingBullish = expert.delta >= 10;
  const expertsShiftingBearish = expert.delta <= -10;
  const compositeFearful = compositeIndex < 30;
  const compositeGreedy = compositeIndex > 70;

  let divergence = false;
  let divergenceType: SentimentMetrics["divergenceType"] = null;

  if (expertsShiftingBullish && compositeFearful) {
    divergence = true;
    divergenceType = "experts_bullish_crowd_fearful";
  } else if (expertsShiftingBearish && compositeGreedy) {
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
    consensusDelta7d: expert.delta,
    divergence,
    divergenceType,
  };
}

// ─── State machine ────────────────────────────────────────────────────────────

function determineRegime(metrics: SentimentMetrics): SentimentRegime {
  const { consensusDelta7d: delta, divergence, compositeIndex } = metrics;

  // Divergence overrides everything — most actionable signal
  if (divergence) return "SENTIMENT_DIVERGENCE";

  // Consensus momentum + composite aligned at extremes
  if (delta >= 10 && compositeIndex > 70) return "CONSENSUS_BULLISH";
  if (delta <= -10 && compositeIndex < 30) return "CONSENSUS_BEARISH";

  // Composite-driven regimes
  if (compositeIndex < 20) return "EXTREME_FEAR";
  if (compositeIndex > 80) return "EXTREME_GREED";
  if (compositeIndex < 40) return "FEAR";
  if (compositeIndex > 60) return "GREED";

  return "SENTIMENT_NEUTRAL";
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

  // Delta-based consensus events (week-over-week change in consensus index)
  const delta = metrics.consensusDelta7d;
  if (delta >= 10) {
    events.push({
      type: "consensus_bullish",
      detail: `Expert consensus rising: +${delta.toFixed(1)} pts over 7d (${metrics.totalAnalysts} analysts, ${Math.round(metrics.bullishRatio * 100)}% bullish)`,
      at: timestamp,
    });
  } else if (delta <= -20) {
    events.push({
      type: "consensus_deteriorating_severe",
      detail: `Expert consensus collapsing: ${delta.toFixed(1)} pts over 7d (${metrics.totalAnalysts} analysts, ${Math.round(metrics.bullishRatio * 100)}% bullish)`,
      at: timestamp,
    });
  } else if (delta <= -10) {
    events.push({
      type: "consensus_deteriorating",
      detail: `Expert consensus dropping: ${delta.toFixed(1)} pts over 7d (${metrics.totalAnalysts} analysts, ${Math.round(metrics.bullishRatio * 100)}% bullish)`,
      at: timestamp,
    });
  }

  if (metrics.divergence) {
    const d = metrics.consensusDelta7d;
    const desc = metrics.divergenceType === "experts_bullish_crowd_fearful"
      ? `Experts shifting bullish (Δ${d > 0 ? "+" : ""}${d.toFixed(1)} pts/7d) while composite fearful (${metrics.compositeIndex.toFixed(1)})`
      : `Experts shifting bearish (Δ${d.toFixed(1)} pts/7d) while composite greedy (${metrics.compositeIndex.toFixed(1)})`;
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
