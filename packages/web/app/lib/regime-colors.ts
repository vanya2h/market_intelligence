import type { Regime } from "@market-intel/api";

type RegimeColor = { color: string; arrow: string };

const REGIME_LABELS: Record<Regime, string> = {
  // Positioning
  CROWDED_LONG: "Crowded Long",
  CROWDED_SHORT: "Crowded Short",
  HEATING_UP: "Heating Up",
  POSITIONING_NEUTRAL: "Neutral",
  // ETF
  STRONG_INFLOW: "Strong Inflow",
  STRONG_OUTFLOW: "Strong Outflow",
  REVERSAL_TO_INFLOW: "Reversal to Inflow",
  REVERSAL_TO_OUTFLOW: "Reversal to Outflow",
  ETF_NEUTRAL: "Neutral",
  MIXED: "Mixed",
  // HTF
  MACRO_BULLISH: "Macro Bullish",
  BULL_EXTENDED: "Bull Extended",
  MACRO_BEARISH: "Macro Bearish",
  BEAR_EXTENDED: "Bear Extended",
  RECLAIMING: "Reclaiming",
  RANGING: "Ranging",
  ACCUMULATION: "Accumulation",
  DISTRIBUTION: "Distribution",
  // Exchange Flows
  EF_NEUTRAL: "Neutral",
  HEAVY_INFLOW: "Heavy Inflow",
  HEAVY_OUTFLOW: "Heavy Outflow",
  // Sentiment
  EXTREME_FEAR: "Extreme Fear",
  FEAR: "Fear",
  SENTIMENT_NEUTRAL: "Neutral",
  GREED: "Greed",
  EXTREME_GREED: "Extreme Greed",
  CONSENSUS_BULLISH: "Consensus Bullish",
  CONSENSUS_BEARISH: "Consensus Bearish",
  SENTIMENT_DIVERGENCE: "Divergence",
};

const GREEN: RegimeColor = { color: "var(--green)", arrow: "\u2197" };
const RED: RegimeColor = { color: "var(--red)", arrow: "\u2198" };
const AMBER: RegimeColor = { color: "var(--amber)", arrow: "\u2192" };
const NEUTRAL: RegimeColor = { color: "var(--text-secondary)", arrow: "\u2192" };

const REGIME_COLORS: Record<Regime, RegimeColor> = {
  // Positioning
  CROWDED_LONG: AMBER,
  CROWDED_SHORT: AMBER,
  HEATING_UP: AMBER,
  POSITIONING_NEUTRAL: NEUTRAL,
  // ETF
  STRONG_INFLOW: GREEN,
  STRONG_OUTFLOW: RED,
  REVERSAL_TO_INFLOW: GREEN,
  REVERSAL_TO_OUTFLOW: RED,
  ETF_NEUTRAL: NEUTRAL,
  MIXED: NEUTRAL,
  // HTF
  MACRO_BULLISH: GREEN,
  BULL_EXTENDED: AMBER,
  MACRO_BEARISH: RED,
  BEAR_EXTENDED: AMBER,
  RECLAIMING: GREEN,
  RANGING: NEUTRAL,
  ACCUMULATION: GREEN,
  DISTRIBUTION: RED,
  // Exchange Flows
  EF_NEUTRAL: NEUTRAL,
  HEAVY_INFLOW: RED, // inflow to exchanges = bearish (selling pressure)
  HEAVY_OUTFLOW: GREEN, // outflow from exchanges = bullish (accumulation)
  // Sentiment
  EXTREME_FEAR: RED,
  FEAR: RED,
  SENTIMENT_NEUTRAL: NEUTRAL,
  GREED: GREEN,
  EXTREME_GREED: GREEN,
  CONSENSUS_BULLISH: GREEN,
  CONSENSUS_BEARISH: RED,
  SENTIMENT_DIVERGENCE: AMBER,
};

export function regimeLabel(regime: Regime): string {
  return REGIME_LABELS[regime];
}

export function regimeColor(regime: Regime): RegimeColor {
  return REGIME_COLORS[regime];
}

export function sentimentColor(value: number): string {
  if (value <= 25) return "var(--red)";
  if (value <= 40) return "var(--red)";
  if (value <= 60) return "var(--amber)";
  if (value <= 75) return "var(--green)";
  return "var(--green)";
}
