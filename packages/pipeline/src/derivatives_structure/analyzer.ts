/**
 * Derivatives Structure — Deterministic Analyzer
 *
 * Applies the state machine transition rules from the spec to produce a
 * structured DerivativesContext. No LLM involved — all logic is deterministic.
 *
 * Transition rules (from data_dimensions.md):
 *   funding percentile(1m) > 80 + L/S > 2.0              → CROWDED_LONG
 *   funding percentile(1m) < 20 + L/S < 0.8              → CROWDED_SHORT
 *   OI dropping > 5% in 24h + liquidations pct(1m) > 70  → UNWINDING
 *   funding negative 3+ cycles + OI declining             → DELEVERAGING
 *   liquidations > pct(3m) 90 + OI dropping sharply       → CAPITULATION
 *   funding pct(1m) 40–70 + L/S 1.2–2.0                  → HEATING_UP
 *   else                                                   → NEUTRAL
 */

import {
  DerivativesSnapshot,
  DerivativesContext,
  DerivativesRegime,
  DerivativesState,
  MetricContext,
  LiquidationContext,
  OiSignal,
  RegimeEvent,
  TimestampedValue,
} from "../types.js";

// ─── Percentile helper ───────────────────────────────────────────────────────

function computePercentile(history: TimestampedValue[], current: number): number {
  if (history.length === 0) return 50;
  const below = history.filter((h) => h.value < current).length;
  return Math.round((below / history.length) * 100);
}

// ─── Timeframe window helpers ────────────────────────────────────────────────

function windowValues(
  history: TimestampedValue[],
  hours: number,
  nowMs: number
): number[] {
  const cutoff = nowMs - hours * 60 * 60 * 1000;
  return history
    .filter((h) => new Date(h.timestamp).getTime() >= cutoff)
    .map((h) => h.value);
}

function buildMetricContext(
  current: number,
  history: TimestampedValue[],
  nowMs: number
): MetricContext {
  const w1w = windowValues(history, 7 * 24, nowMs);
  const w1m = windowValues(history, 30 * 24, nowMs);

  const high = (vals: number[]) =>
    vals.length ? Math.max(...vals) : current;
  const low = (vals: number[]) =>
    vals.length ? Math.min(...vals) : current;

  return {
    current,
    highs: {
      "1w": parseFloat(high(w1w).toFixed(6)),
      "1m": parseFloat(high(w1m).toFixed(6)),
    },
    lows: {
      "1w": parseFloat(low(w1w).toFixed(6)),
      "1m": parseFloat(low(w1m).toFixed(6)),
    },
    percentile: {
      "1m": computePercentile(history, current),
    },
  };
}

function buildLiquidationContext(
  current8h: number,
  bias: string,
  history: TimestampedValue[],
  nowMs: number
): LiquidationContext {
  const w1w = windowValues(history, 7 * 24, nowMs);
  const w1m = windowValues(history, 30 * 24, nowMs);

  const high = (vals: number[]) =>
    vals.length ? Math.max(...vals) : current8h;

  return {
    current8h,
    bias,
    highs: {
      "1w": high(w1w),
      "1m": high(w1m),
    },
    percentile: {
      "1m": computePercentile(history, current8h),
    },
  };
}

// ─── Event detection ─────────────────────────────────────────────────────────

function detectEvents(
  snapshot: DerivativesSnapshot,
  nowMs: number
): RegimeEvent[] {
  const events: RegimeEvent[] = [];

  // OI spike/drop vs 1h ago
  const oiHistory = snapshot.openInterest.history1m;
  if (oiHistory.length >= 1) {
    const prev = oiHistory[oiHistory.length - 1]!.value;
    const change = (snapshot.openInterest.current - prev) / prev;
    if (Math.abs(change) >= 0.025) {
      events.push({
        type: change > 0 ? "oi_spike" : "oi_drop",
        detail: `${(change * 100).toFixed(1)}% vs 1h ago`,
        at: new Date(nowMs).toISOString(),
      });
    }
  }

  // Funding flip: last recorded value had opposite sign to current
  const fundingHistory = snapshot.funding.history1m;
  if (fundingHistory.length >= 1) {
    const prev = fundingHistory[fundingHistory.length - 1]!.value;
    if (prev < 0 && snapshot.funding.current > 0) {
      events.push({
        type: "funding_flip",
        detail: "negative → positive",
        at: new Date(nowMs).toISOString(),
      });
    } else if (prev > 0 && snapshot.funding.current < 0) {
      events.push({
        type: "funding_flip",
        detail: "positive → negative",
        at: new Date(nowMs).toISOString(),
      });
    }
  }

  return events;
}

// ─── State machine ───────────────────────────────────────────────────────────

function determineRegime(
  fundingPct1m: number,
  lsPct1m: number, // percentile of L/S ratio
  ls: number,
  oiChangePct24h: number,
  liqPct1m: number,
  fundingNegativeCycles: number,
  oiDeclining: boolean
): DerivativesRegime {
  // CROWDED_LONG: funding high + heavily long-biased
  if (fundingPct1m > 80 && ls > 2.0) return "CROWDED_LONG";

  // CROWDED_SHORT: funding low/negative + heavily short-biased
  if (fundingPct1m < 20 && ls < 0.8) return "CROWDED_SHORT";

  // CAPITULATION: liquidations extreme + OI dropping sharply
  if (liqPct1m > 90 && oiChangePct24h < -0.08) return "CAPITULATION";

  // UNWINDING: OI falling + liquidations elevated
  if (oiChangePct24h < -0.05 && liqPct1m > 70) return "UNWINDING";

  // DELEVERAGING: persistent negative funding + OI declining
  if (fundingNegativeCycles >= 3 && oiDeclining) return "DELEVERAGING";

  // SHORT_SQUEEZE: was CROWDED_SHORT and OI now spiking
  // (handled by transition logic in caller — not detectable from snapshot alone)

  // HEATING_UP: building toward crowded but not there yet
  if (fundingPct1m >= 40 && fundingPct1m <= 80 && ls >= 1.2 && ls <= 2.0)
    return "HEATING_UP";

  return "NEUTRAL";
}

// ─── OI change over 24h ──────────────────────────────────────────────────────

function oiChangePct24h(snapshot: DerivativesSnapshot, nowMs: number): number {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const prev = snapshot.openInterest.history1m
    .filter((h) => new Date(h.timestamp).getTime() >= cutoff)
    .at(0); // oldest entry within window

  if (!prev) return 0;
  return (snapshot.openInterest.current - prev.value) / prev.value;
}

function countNegativeFundingCycles(snapshot: DerivativesSnapshot): number {
  // Count most-recent consecutive negative funding periods
  let count = 0;
  for (let i = snapshot.funding.history1m.length - 1; i >= 0; i--) {
    if (snapshot.funding.history1m[i]!.value < 0) count++;
    else break;
  }
  return count;
}

function isOiDeclining(snapshot: DerivativesSnapshot, nowMs: number): boolean {
  return oiChangePct24h(snapshot, nowMs) < -0.02;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function analyze(
  snapshot: DerivativesSnapshot,
  prevState: DerivativesState | null
): { context: DerivativesContext; nextState: DerivativesState } {
  const nowMs = new Date(snapshot.timestamp).getTime();

  const fundingCtx = buildMetricContext(
    snapshot.funding.current,
    snapshot.funding.history1m,
    nowMs
  );
  const oiCtx = buildMetricContext(
    snapshot.openInterest.current,
    snapshot.openInterest.history1m,
    nowMs
  );
  const liqCtx = buildLiquidationContext(
    snapshot.liquidations.current8h,
    snapshot.liquidations.bias,
    snapshot.liquidations.history1m,
    nowMs
  );
  const lsCtx = buildMetricContext(
    snapshot.longShortRatio.current,
    // L/S ratio has no history in mock — use empty array, percentile will be 50
    [],
    nowMs
  );
  const cbPremiumCtx = buildMetricContext(
    snapshot.coinbasePremium.current,
    snapshot.coinbasePremium.history1m,
    nowMs
  );

  const fundingPct1m = fundingCtx.percentile["1m"];
  const liqPct1m = liqCtx.percentile["1m"];
  const oiChg = oiChangePct24h(snapshot, nowMs);
  const negCycles = countNegativeFundingCycles(snapshot);
  const oiDecl = isOiDeclining(snapshot, nowMs);

  const regime = determineRegime(
    fundingPct1m,
    50, // L/S percentile — not used in rules directly, only absolute value
    snapshot.longShortRatio.current,
    oiChg,
    liqPct1m,
    negCycles,
    oiDecl
  );

  // Determine regime start time
  const since =
    prevState?.regime === regime
      ? prevState.since
      : snapshot.timestamp;

  const durationHours = Math.round(
    (nowMs - new Date(since).getTime()) / (1000 * 60 * 60)
  );

  const previousRegime =
    prevState?.regime !== regime ? (prevState?.regime ?? null) : (prevState?.previousRegime ?? null);

  const events = detectEvents(snapshot, nowMs);

  const oiPct1m = oiCtx.percentile["1m"];
  const oiSignal: OiSignal =
    oiPct1m > 90 ? "EXTREME" :
    oiPct1m > 70 ? "ELEVATED" :
    oiPct1m < 30 ? "DEPRESSED" :
    "NORMAL";

  const context: DerivativesContext = {
    asset: snapshot.asset,
    regime,
    oiSignal,
    since,
    durationHours,
    previousRegime,
    funding: fundingCtx,
    openInterest: oiCtx,
    liquidations: liqCtx,
    longShortRatio: lsCtx,
    coinbasePremium: cbPremiumCtx,
    events,
  };

  const nextState: DerivativesState = {
    asset: snapshot.asset,
    regime,
    since,
    previousRegime,
    lastUpdated: snapshot.timestamp,
  };

  return { context, nextState };
}
