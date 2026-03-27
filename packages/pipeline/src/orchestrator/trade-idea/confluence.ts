/**
 * Confluence Mapper
 *
 * Maps each dimension's regime state to an agreement score relative
 * to the trade idea direction:
 *   +1 = agrees (regime supports the direction)
 *   -1 = disagrees (regime opposes the direction)
 *    0 = neutral (regime is ambiguous or not applicable)
 *
 * For derivatives, both positioning and stress are considered.
 * The final score is clamped to [-1, 0, +1].
 */

import type {
  PositioningRegime,
  StressLevel,
  EtfRegime,
  HtfRegime,
  SentimentRegime,
} from "../../generated/prisma/client.js";
import type { DimensionOutput } from "../types.js";
import type { Direction } from "./composite-target.js";

export type AgreementScore = -1 | 0 | 1;

export interface Confluence {
  derivatives: AgreementScore;
  etfs: AgreementScore;
  htf: AgreementScore;
  sentiment: AgreementScore;
}

// ─── Derivatives ─────────────────────────────────────────────────────────────
// Swing reversal logic: crowded positioning in opposite direction = agrees
// Stress (capitulation/unwinding) = mean-reversion opportunity = agrees with LONG

const POSITIONING_LONG: PositioningRegime[] = ["CROWDED_SHORT"];
const POSITIONING_SHORT: PositioningRegime[] = ["CROWDED_LONG", "HEATING_UP"];

const STRESS_LONG: StressLevel[] = ["CAPITULATION", "UNWINDING"];
const STRESS_SHORT: StressLevel[] = [];
// Deleveraging is ambiguous — could precede moves in either direction

function scoreDerivatives(
  regime: PositioningRegime,
  stress: StressLevel | null,
  direction: Direction,
): AgreementScore {
  if (direction === "FLAT") return 0;

  const longSet = direction === "LONG" ? POSITIONING_LONG : POSITIONING_SHORT;
  const shortSet = direction === "LONG" ? POSITIONING_SHORT : POSITIONING_LONG;
  const stressAgrees = direction === "LONG" ? STRESS_LONG : STRESS_SHORT;

  let score = 0;

  if (longSet.includes(regime)) score += 1;
  else if (shortSet.includes(regime)) score -= 1;

  if (stress && stressAgrees.includes(stress)) score += 1;

  return Math.max(-1, Math.min(1, score)) as AgreementScore;
}

// ─── ETFs ────────────────────────────────────────────────────────────────────
// Institutional flow direction = directional signal

const ETF_LONG: EtfRegime[] = ["STRONG_INFLOW", "REVERSAL_TO_INFLOW"];
const ETF_SHORT: EtfRegime[] = ["STRONG_OUTFLOW", "REVERSAL_TO_OUTFLOW"];

function scoreEtfs(regime: EtfRegime, direction: Direction): AgreementScore {
  if (direction === "FLAT") return 0;

  const agrees = direction === "LONG" ? ETF_LONG : ETF_SHORT;
  const disagrees = direction === "LONG" ? ETF_SHORT : ETF_LONG;

  if (agrees.includes(regime)) return 1;
  if (disagrees.includes(regime)) return -1;
  return 0;
}

// ─── HTF ─────────────────────────────────────────────────────────────────────
// Trend structure alignment — note: for swing reversal, extended regimes
// in the OPPOSITE direction can actually agree (mean-reversion setup)

const HTF_LONG: HtfRegime[] = ["MACRO_BULLISH", "RECLAIMING", "ACCUMULATION"];
const HTF_SHORT: HtfRegime[] = ["MACRO_BEARISH", "DISTRIBUTION"];

// Extended regimes suggest mean-reversion in the opposite direction
const HTF_REVERSION_LONG: HtfRegime[] = ["BEAR_EXTENDED"];
const HTF_REVERSION_SHORT: HtfRegime[] = ["BULL_EXTENDED"];

function scoreHtf(regime: HtfRegime, direction: Direction): AgreementScore {
  if (direction === "FLAT") {
    return regime === "RANGING" ? 1 : 0;
  }

  const agrees = direction === "LONG"
    ? [...HTF_LONG, ...HTF_REVERSION_LONG]
    : [...HTF_SHORT, ...HTF_REVERSION_SHORT];
  const disagrees = direction === "LONG"
    ? [...HTF_SHORT, ...HTF_REVERSION_SHORT]
    : [...HTF_LONG, ...HTF_REVERSION_LONG];

  if (agrees.includes(regime)) return 1;
  if (disagrees.includes(regime)) return -1;
  return 0;
}

// ─── Sentiment ───────────────────────────────────────────────────────────────
// Contrarian: extreme fear = agrees with LONG (crowd capitulation = buy)
// Extreme greed = agrees with SHORT (crowd euphoria = sell)

const SENTIMENT_LONG: SentimentRegime[] = ["EXTREME_FEAR", "FEAR", "CONSENSUS_BULLISH"];
const SENTIMENT_SHORT: SentimentRegime[] = ["EXTREME_GREED", "GREED", "CONSENSUS_BEARISH"];

function scoreSentiment(regime: SentimentRegime, direction: Direction): AgreementScore {
  if (direction === "FLAT") {
    return regime === "SENTIMENT_NEUTRAL" ? 1 : 0;
  }

  const agrees = direction === "LONG" ? SENTIMENT_LONG : SENTIMENT_SHORT;
  const disagrees = direction === "LONG" ? SENTIMENT_SHORT : SENTIMENT_LONG;

  if (agrees.includes(regime)) return 1;
  if (disagrees.includes(regime)) return -1;
  return 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeConfluence(
  outputs: DimensionOutput[],
  direction: Direction,
): Confluence {
  const deriv = outputs.find((o) => o.dimension === "DERIVATIVES");
  const etfs = outputs.find((o) => o.dimension === "ETFS");
  const htf = outputs.find((o) => o.dimension === "HTF");
  const sent = outputs.find((o) => o.dimension === "SENTIMENT");

  return {
    derivatives: deriv ? scoreDerivatives(deriv.regime, deriv.stress, direction) : 0,
    etfs: etfs ? scoreEtfs(etfs.regime, direction) : 0,
    htf: htf ? scoreHtf(htf.regime, direction) : 0,
    sentiment: sent ? scoreSentiment(sent.regime, direction) : 0,
  };
}
