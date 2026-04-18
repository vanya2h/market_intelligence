import type { DimensionEventType } from "@market-intel/api";

export type EventColor = "green" | "red" | "amber";

export interface EventDisplay {
  color: EventColor;
  /** Human-readable title override. If omitted, type is shown with underscores → spaces. */
  title?: string;
}

/**
 * Exhaustive mapping from every dimension event type to its display color.
 *
 * The `satisfies Record<DimensionEventType, EventDisplay>` constraint below
 * is what enforces exhaustiveness: adding a new event literal to any dimension's
 * `XxxEventType` union without adding a key here will fail to typecheck.
 * Removing a key also breaks the build.
 */
export const EVENT_DISPLAY: Record<DimensionEventType, EventDisplay> = {
  // ─── Derivatives ─────────────────────────────────────────────────────────
  oi_spike: { color: "green" },
  oi_drop: { color: "red" },
  funding_flip: { color: "amber" },
  liq_spike: { color: "amber" },
  ls_extreme: { color: "amber" },

  // ─── ETFs ────────────────────────────────────────────────────────────────
  sigma_inflow: { color: "green" },
  sigma_outflow: { color: "red" },
  gbtc_discount: { color: "red" },
  gbtc_premium: { color: "green" },

  // ─── HTF: Moving averages / price structure ─────────────────────────────
  golden_cross: { color: "green" },
  death_cross: { color: "red" },
  dma200_reclaim: { color: "green" },
  dma200_break: { color: "red" },

  // ─── HTF: RSI ────────────────────────────────────────────────────────────
  rsi_daily_overbought: { color: "red" },
  rsi_daily_oversold: { color: "green" },
  rsi_divergence_bullish: { color: "green" },
  rsi_divergence_bearish: { color: "red" },

  // ─── HTF: MFI (volume-weighted momentum) ────────────────────────────────
  mfi_overbought: { color: "red" },
  mfi_oversold: { color: "green" },
  mfi_divergence_bullish: { color: "green" },
  mfi_divergence_bearish: { color: "red" },

  // ─── HTF: Market structure ─────────────────────────────────────────────
  structure_shift_bullish: { color: "green" },
  structure_shift_bearish: { color: "red" },

  // ─── HTF: CVD ───────────────────────────────────────────────────────────
  cvd_divergence_bullish: { color: "green" },
  cvd_divergence_bearish: { color: "red" },
  cvd_suspect_bounce: { color: "red" },
  cvd_overbought: { color: "red" },
  cvd_oversold: { color: "green" },

  // ─── HTF: Multi-indicator divergence (mean reversion trigger) ─────────
  divergence_confluence_bullish: { color: "green", title: "confluence bullish" },
  divergence_confluence_bearish: { color: "red", title: "confluence bearish" },

  // ─── HTF: STH cost basis ───────────────────────────────────────────────
  sth_reclaim: { color: "green" },
  sth_break: { color: "red" },

  // ─── Sentiment ──────────────────────────────────────────────────────────
  extreme_fear: { color: "green" },
  extreme_greed: { color: "red" },
  consensus_bullish: { color: "green" },
  consensus_bearish: { color: "red" },
  consensus_deteriorating: { color: "red" },
  consensus_deteriorating_severe: { color: "red" },
  sentiment_divergence: { color: "amber" },

  // ─── Exchange flows ─────────────────────────────────────────────────────
  heavy_inflow: { color: "red" }, // coins TO exchanges = supply for sale = bearish
  heavy_outflow: { color: "green" }, // coins OFF exchanges = holders accumulating = bullish
  reserve_low: { color: "green" },
  reserve_high: { color: "red" },
};

const COLOR_VAR: Record<EventColor, string> = {
  green: "var(--green)",
  red: "var(--red)",
  amber: "var(--amber)",
};

/**
 * Get the CSS color variable for an event type.
 *
 * Accepts a generic `string` (since events arrive from JSON at runtime) and
 * narrows via lookup. Unknown types — which should be impossible if the
 * pipeline and web are in sync — fall back to amber.
 */
export function eventColorVar(type: string): string {
  const display = EVENT_DISPLAY[type as DimensionEventType];
  return display ? COLOR_VAR[display.color] : "var(--amber)";
}

/** Human-readable label for an event type. */
export function eventLabel(type: string): string {
  const display = EVENT_DISPLAY[type as DimensionEventType];
  if (display?.title) return display.title;
  return type.replace(/_/g, " ");
}
