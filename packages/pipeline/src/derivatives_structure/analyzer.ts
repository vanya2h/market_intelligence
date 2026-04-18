/**
 * Derivatives Structure — Deterministic Analyzer
 *
 * Two-dimensional deterministic classifier per spec:
 *   Dimension 1 — Positioning (slow, structural): CROWDED_LONG / CROWDED_SHORT / HEATING_UP / NEUTRAL
 *   Dimension 2 — Stress     (fast, event-driven): CAPITULATION / UNWINDING / DELEVERAGING / NONE
 *
 * Design invariants:
 *   - Both dimensions are always resolved (no single-label collapse)
 *   - Stress uses strict priority ordering (Capitulation > Unwinding > Deleveraging > None)
 *   - Positioning is evaluated independently (never overridden by stress)
 *   - Every state requires ≥2 confirming signals
 *   - Hysteresis buffers prevent rapid threshold flipping
 *   - All triggering signals are captured for traceability
 */

import {
  AnalysisSignals,
  Classified,
  DerivativesContext,
  DerivativesSnapshot,
  DerivativesState,
  LiquidationContext,
  MetricContext,
  OiSignal,
  PositioningState,
  RegimeEvent,
  StressState,
  TimestampedValue,
} from "../types.js";

// ─── History window helpers ───────────────────────────────────────────────────

function windowHistory(history: TimestampedValue[], hours: number, nowMs: number): TimestampedValue[] {
  const cutoff = nowMs - hours * 60 * 60 * 1000;
  return history.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
}

function windowValues(history: TimestampedValue[], hours: number, nowMs: number): number[] {
  return windowHistory(history, hours, nowMs).map((h) => h.value);
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

function computePercentile(values: number[], current: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < current).length;
  return Math.round((below / values.length) * 100);
}

function computeZScore(values: number[], current: number): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (current - mean) / std : 0;
}

/**
 * Fractional change from the oldest entry inside a lookback window to current.
 * Returns 0 when history is insufficient.
 */
function computeChange(history: TimestampedValue[], current: number, hours: number, nowMs: number): number {
  const cutoff = nowMs - hours * 60 * 60 * 1000;
  const inWindow = history.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
  const prev = inWindow.at(0); // oldest in window ≈ value `hours` ago
  if (!prev || prev.value === 0) return 0;
  return (current - prev.value) / prev.value;
}

// ─── Metric builders ─────────────────────────────────────────────────────────

function buildMetricContext(current: number, history: TimestampedValue[], nowMs: number): MetricContext {
  const w1w = windowValues(history, 7 * 24, nowMs);
  const w1m = windowValues(history, 30 * 24, nowMs);

  const high = (vals: number[]) => (vals.length ? Math.max(...vals) : current);
  const low = (vals: number[]) => (vals.length ? Math.min(...vals) : current);

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
      "1m": computePercentile(w1m, current),
    },
  };
}

function buildLiquidationContext(
  current8h: number,
  bias: string,
  history: TimestampedValue[],
  nowMs: number,
): LiquidationContext {
  const w1w = windowValues(history, 7 * 24, nowMs);
  const w1m = windowValues(history, 30 * 24, nowMs);
  const w3m = windowValues(history, 90 * 24, nowMs);

  const high = (vals: number[]) => (vals.length ? Math.max(...vals) : current8h);

  return {
    current8h,
    bias,
    highs: {
      "1w": high(w1w),
      "1m": high(w1m),
    },
    percentile: {
      "1m": computePercentile(w1m, current8h),
      "3m": computePercentile(w3m, current8h),
    },
  };
}

// ─── Metric computation ───────────────────────────────────────────────────────

/**
 * Count consecutive funding cycles on the same extreme side of the median.
 *
 * "Extreme" = above 75th or below 25th percentile of the 30-day funding
 * distribution. Walks backwards from the most recent cycle, stopping at
 * the first cycle that is NOT extreme on the same side.
 *
 * Only meaningful when OI is elevated — returns { cycles: 0, side: null }
 * when OI z-score ≤ 0.5 (the spring has no tension without open interest).
 */
function countExtremeFundingCycles(
  snapshot: DerivativesSnapshot,
  oiZScore30d: number,
): { cycles: number; side: "LONG" | "SHORT" | null } {
  // No pressure without elevated OI
  if (oiZScore30d <= 0.5) return { cycles: 0, side: null };

  const values = snapshot.funding.history1m.map((h) => h.value);
  if (values.length < 4) return { cycles: 0, side: null };

  // Compute median funding rate over the window
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // Compute IQR-based thresholds (75th / 25th percentile)
  const q75Idx = Math.floor(sorted.length * 0.75);
  const q25Idx = Math.floor(sorted.length * 0.25);
  const upperThresh = sorted[q75Idx]!;
  const lowerThresh = sorted[q25Idx]!;

  // Determine which side the most recent cycle is on
  const latest = values[values.length - 1]!;
  let side: "LONG" | "SHORT" | null = null;
  if (latest > upperThresh)
    side = "LONG"; // longs paying shorts → crowded long
  else if (latest < lowerThresh)
    side = "SHORT"; // shorts paying longs → crowded short
  else return { cycles: 0, side: null }; // not extreme

  // Count consecutive extreme cycles on the same side
  const isExtreme =
    side === "LONG"
      ? (v: number) => v > median // above median = same side (relaxed from 75th for continuation)
      : (v: number) => v < median; // below median = same side

  let cycles = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (isExtreme(values[i]!)) cycles++;
    else break;
  }

  return { cycles, side };
}

/** Compute all AnalysisSignals (spec §2) from a snapshot. */
function computeSignals(snapshot: DerivativesSnapshot, liqCtx: LiquidationContext, nowMs: number): AnalysisSignals {
  const fundingVals1m = windowValues(snapshot.funding.history1m, 30 * 24, nowMs);
  const oiVals30d = windowValues(snapshot.openInterest.history1m, 30 * 24, nowMs);

  const fundingPct1m = computePercentile(fundingVals1m, snapshot.funding.current);
  const liqPct1m = liqCtx.percentile["1m"];
  const liqPct3m = liqCtx.percentile["3m"] ?? liqPct1m;

  const oiChange24h = computeChange(snapshot.openInterest.history1m, snapshot.openInterest.current, 24, nowMs);
  const oiChange7d = computeChange(snapshot.openInterest.history1m, snapshot.openInterest.current, 7 * 24, nowMs);
  const oiZScore30d = computeZScore(oiVals30d, snapshot.openInterest.current);

  let priceReturn24h: number | null = null;
  let priceReturn7d: number | null = null;
  if (snapshot.price && snapshot.price.history.length > 0) {
    const priceCurrent = snapshot.price.history.at(-1)!.value;
    priceReturn24h = computeChange(snapshot.price.history, priceCurrent, 24, nowMs);
    priceReturn7d = computeChange(snapshot.price.history, priceCurrent, 7 * 24, nowMs);
  }

  const pressure = countExtremeFundingCycles(snapshot, oiZScore30d);

  return {
    fundingPct1m,
    liqPct1m,
    liqPct3m,
    oiChange24h,
    oiChange7d,
    oiZScore30d,
    priceReturn24h,
    priceReturn7d,
    fundingPressureCycles: pressure.cycles,
    fundingPressureSide: pressure.side,
  };
}

// ─── Positioning classifier (spec §3) ────────────────────────────────────────
//
// Hysteresis: lower thresholds when already in the target state to prevent
// rapid flipping at the boundary.

function classifyPositioning(
  signals: AnalysisSignals,
  prevPositioning: PositioningState | null,
): Classified<PositioningState> {
  const { fundingPct1m, oiZScore30d, oiChange7d, priceReturn24h, priceReturn7d } = signals;

  // Elevated OI: at least one OI signal confirms above-average open interest
  const oiElevated = oiZScore30d > 0.5;

  // ── CROWDED_LONG ───────────────────────────────────────────────────────────
  // Entry threshold: fundingPct1m > 80; exit (hysteresis): > 75
  const clFundingThresh = prevPositioning === "CROWDED_LONG" ? 75 : 80;
  const clFundingFires = fundingPct1m > clFundingThresh;
  const clOiFires = oiElevated;
  // Non-negative price: pass if data unavailable (graceful degradation)
  const clPriceFires =
    priceReturn24h === null && priceReturn7d === null
      ? null // unknown — don't penalise
      : (priceReturn24h ?? 0) >= -0.01 || (priceReturn7d ?? 0) >= -0.02;

  if (clFundingFires) {
    const triggers: string[] = [`fundingPct1m=${fundingPct1m} > ${clFundingThresh}`];
    if (clOiFires) triggers.push(`oiZScore30d=${oiZScore30d.toFixed(2)}`);
    if (clPriceFires === true && priceReturn24h !== null) triggers.push(`priceReturn24h=${pct(priceReturn24h)}`);
    // Require funding + at least 1 confirmation (spec: avoid single-trigger states)
    if (triggers.length >= 2 && (clOiFires || clPriceFires !== false)) {
      return { state: "CROWDED_LONG", triggers };
    }
  }

  // ── CROWDED_SHORT ──────────────────────────────────────────────────────────
  // Entry threshold: fundingPct1m < 20; exit (hysteresis): < 25
  const csFundingThresh = prevPositioning === "CROWDED_SHORT" ? 25 : 20;
  const csFundingFires = fundingPct1m < csFundingThresh;
  const csOiFires = oiElevated;
  const csPriceFires =
    priceReturn24h === null && priceReturn7d === null
      ? null
      : (priceReturn24h ?? 0) <= 0.01 || (priceReturn7d ?? 0) <= 0.02;

  if (csFundingFires) {
    const triggers: string[] = [`fundingPct1m=${fundingPct1m} < ${csFundingThresh}`];
    if (csOiFires) triggers.push(`oiZScore30d=${oiZScore30d.toFixed(2)}`);
    if (csPriceFires === true && priceReturn24h !== null) triggers.push(`priceReturn24h=${pct(priceReturn24h)}`);
    if (triggers.length >= 2 && (csOiFires || csPriceFires !== false)) {
      return { state: "CROWDED_SHORT", triggers };
    }
  }

  // ── HEATING_UP ─────────────────────────────────────────────────────────────
  // Mid-funding percentile + OI increasing over medium horizon (≥2 signals)
  const huFundingFires = fundingPct1m >= 40 && fundingPct1m <= 70;
  const huOiFires = oiChange7d > 0.02;

  if (huFundingFires && huOiFires) {
    return {
      state: "HEATING_UP",
      triggers: [`fundingPct1m=${fundingPct1m} (40–70 range)`, `oiChange7d=${pct(oiChange7d)} > +2%`],
    };
  }

  return { state: "POSITIONING_NEUTRAL", triggers: [] };
}

// ─── Stress classifier (spec §4) — strict priority ordering ──────────────────
//
// Priority: CAPITULATION > UNWINDING > DELEVERAGING > NONE
// Hysteresis applied per state.

function classifyStress(signals: AnalysisSignals, prevStress: StressState | null): Classified<StressState> {
  const { liqPct1m, liqPct3m, oiChange24h, oiChange7d, priceReturn24h, fundingPressureCycles, fundingPressureSide } =
    signals;

  // ── 1. CAPITULATION (highest priority) ────────────────────────────────────
  // Requires ≥2 of 3 confirming signals.
  // Hysteresis: lower thresholds when already in CAPITULATION.
  const inCap = prevStress === "CAPITULATION";
  const capLiqThresh = inCap ? 85 : 90;
  const capOiThresh = inCap ? -0.07 : -0.1;

  const capLiqFires = liqPct3m > capLiqThresh;
  const capOiFires = oiChange24h <= capOiThresh;
  const capPriceFires = priceReturn24h !== null && Math.abs(priceReturn24h) >= 0.05;

  const capSignals: string[] = [];
  if (capLiqFires) capSignals.push(`liqPct3m=${liqPct3m} > ${capLiqThresh}`);
  if (capOiFires) capSignals.push(`oiChange24h=${pct(oiChange24h)} ≤ ${pct(capOiThresh)}`);
  if (capPriceFires) capSignals.push(`|priceReturn24h|=${pct(Math.abs(priceReturn24h!))} ≥ 5%`);

  if (capSignals.length >= 2) {
    return { state: "CAPITULATION", triggers: capSignals };
  }

  // ── 2. UNWINDING ──────────────────────────────────────────────────────────
  // Both signals required.
  // Hysteresis: stay in UNWINDING with lower thresholds.
  const inUnw = prevStress === "UNWINDING";
  const unwOiThresh = inUnw ? -0.03 : -0.05;
  const unwLiqThresh = inUnw ? 60 : 70;

  const unwOiFires = oiChange24h <= unwOiThresh;
  const unwLiqFires = liqPct1m > unwLiqThresh;

  if (unwOiFires && unwLiqFires) {
    return {
      state: "UNWINDING",
      triggers: [`oiChange24h=${pct(oiChange24h)} ≤ ${pct(unwOiThresh)}`, `liqPct1m=${liqPct1m} > ${unwLiqThresh}`],
    };
  }

  // ── 3. DELEVERAGING ───────────────────────────────────────────────────────
  // All conditions required.
  // Hysteresis: lower cycle count and OI thresholds when already in DELEVERAGING.
  const inDlv = prevStress === "DELEVERAGING";
  const dlvCycleThresh = inDlv ? 2 : 3;
  const dlvOi24hThresh = inDlv ? -0.01 : -0.02;
  const dlvOi7dThresh = inDlv ? -0.02 : -0.05;
  const dlvLiqCap = inDlv ? 75 : 70; // must be below (no extreme liq)

  const dlvCyclesFire = fundingPressureSide !== null && fundingPressureCycles >= dlvCycleThresh;
  const dlvOiFires = oiChange24h < dlvOi24hThresh || oiChange7d < dlvOi7dThresh;
  const dlvNoLiqSpike = liqPct1m <= dlvLiqCap;

  if (dlvCyclesFire && dlvOiFires && dlvNoLiqSpike) {
    const triggers: string[] = [
      `fundingPressure=${fundingPressureCycles} cycles (${fundingPressureSide}) ≥ ${dlvCycleThresh}`,
      `oiChange24h=${pct(oiChange24h)} or oiChange7d=${pct(oiChange7d)} (gradual decline)`,
      `liqPct1m=${liqPct1m} ≤ ${dlvLiqCap} (no spike)`,
    ];
    return { state: "DELEVERAGING", triggers };
  }

  return { state: "STRESS_NONE", triggers: [] };
}

// ─── Event detection ─────────────────────────────────────────────────────────

function detectEvents(snapshot: DerivativesSnapshot, nowMs: number): RegimeEvent[] {
  const events: RegimeEvent[] = [];

  const oiHistory = snapshot.openInterest.history1m;
  if (oiHistory.length >= 1) {
    const prev = oiHistory[oiHistory.length - 1]!.value;
    const change = (snapshot.openInterest.current - prev) / prev;
    if (Math.abs(change) >= 0.025) {
      events.push({
        type: change > 0 ? "oi_spike" : "oi_drop",
        detail: `${(change * 100).toFixed(1)}% vs prev`,
        at: new Date(nowMs).toISOString(),
      });
    }
  }

  const fundingHistory = snapshot.funding.history1m;
  if (fundingHistory.length >= 1) {
    const prev = fundingHistory[fundingHistory.length - 1]!.value;
    if (prev < 0 && snapshot.funding.current > 0) {
      events.push({ type: "funding_flip", detail: "negative → positive", at: new Date(nowMs).toISOString() });
    } else if (prev > 0 && snapshot.funding.current < 0) {
      events.push({ type: "funding_flip", detail: "positive → negative", at: new Date(nowMs).toISOString() });
    }
  }

  return events;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function analyze(
  snapshot: DerivativesSnapshot,
  prevState: DerivativesState | null,
): { context: DerivativesContext; nextState: DerivativesState } {
  const nowMs = new Date(snapshot.timestamp).getTime();

  // Build metric contexts
  const fundingCtx = buildMetricContext(snapshot.funding.current, snapshot.funding.history1m, nowMs);
  const oiCtx = buildMetricContext(snapshot.openInterest.current, snapshot.openInterest.history1m, nowMs);
  const liqCtx = buildLiquidationContext(
    snapshot.liquidations.current8h,
    snapshot.liquidations.bias,
    snapshot.liquidations.history1m,
    nowMs,
  );
  const cbPremiumCtx = buildMetricContext(snapshot.coinbasePremium.current, snapshot.coinbasePremium.history1m, nowMs);

  // Compute all explicit metrics (spec §2)
  const signals = computeSignals(snapshot, liqCtx, nowMs);

  // Classify positioning (independent, spec §3)
  const positioning = classifyPositioning(signals, prevState?.positioning ?? null);

  // Classify stress with priority ordering (spec §4)
  const stress = classifyStress(signals, prevState?.stress ?? null);

  // Track duration since positioning last changed (stress is shown separately in UI)
  const positioningChanged = prevState?.positioning !== positioning.state;
  const stressChanged = prevState?.stress !== stress.state;
  const since = positioningChanged ? snapshot.timestamp : (prevState?.since ?? snapshot.timestamp);

  const durationHours = Math.round((nowMs - new Date(since).getTime()) / (1000 * 60 * 60));

  const previousPositioning = positioningChanged
    ? (prevState?.positioning ?? null)
    : (prevState?.previousPositioning ?? null);

  const previousStress = stressChanged ? (prevState?.stress ?? null) : (prevState?.previousStress ?? null);

  // OI signal (orthogonal modifier)
  const oiPct1m = oiCtx.percentile["1m"];
  const oiSignal: OiSignal =
    oiPct1m > 90 ? "EXTREME" : oiPct1m > 70 ? "ELEVATED" : oiPct1m < 30 ? "DEPRESSED" : "OI_NORMAL";

  const events = detectEvents(snapshot, nowMs);

  const context: DerivativesContext = {
    asset: snapshot.asset,
    positioning,
    stress,
    signals,
    oiSignal,
    since,
    durationHours,
    previousPositioning,
    previousStress,
    funding: fundingCtx,
    openInterest: oiCtx,
    liquidations: liqCtx,
    coinbasePremium: cbPremiumCtx,
    events,
  };

  const nextState: DerivativesState = {
    asset: snapshot.asset,
    positioning: positioning.state,
    stress: stress.state,
    since,
    previousPositioning,
    previousStress,
    lastUpdated: snapshot.timestamp,
  };

  return { context, nextState };
}
