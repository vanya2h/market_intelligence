/**
 * Exchange Flows — Deterministic Analyzer (Dimension 04)
 *
 * Transition rules:
 *   7d net outflow + reserve declining            → ACCUMULATION
 *   7d net inflow + reserve rising                → DISTRIBUTION
 *   today's delta > 95th percentile (1m)          → HEAVY_INFLOW
 *   today's delta < 5th percentile (1m)           → HEAVY_OUTFLOW
 *   else                                          → EF_NEUTRAL
 *
 * Events:
 *   today's delta > mean + 2σ                     → heavy_inflow
 *   today's delta < mean - 2σ                     → heavy_outflow
 *   total balance at 30d low                      → reserve_low
 *   total balance at 30d high                     → reserve_high
 */

import type {
  BalancePoint,
  ExchangeFlowsContext,
  ExchangeFlowsEvent,
  ExchangeFlowsMetrics,
  ExchangeFlowsRegime,
  ExchangeFlowsSnapshot,
  ExchangeFlowsState,
} from "./types.js";

// ─── Flow metrics ─────────────────────────────────────────────────────────────

/** Compute daily balance deltas from the timeseries */
function dailyDeltas(history: BalancePoint[]): { timestamp: number; delta: number }[] {
  if (history.length < 2) return [];

  const deltas: { timestamp: number; delta: number }[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push({
      timestamp: history[i]!.timestamp,
      delta: history[i]!.totalBalance - history[i - 1]!.totalBalance,
    });
  }
  return deltas;
}

function last30Days(history: BalancePoint[]): BalancePoint[] {
  if (history.length === 0) return [];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return history.filter((p) => p.timestamp >= cutoff);
}

function computeMetrics(snapshot: ExchangeFlowsSnapshot): ExchangeFlowsMetrics {
  const history30 = last30Days(snapshot.balanceHistory);
  const deltas = dailyDeltas(history30);

  const totalBalance = snapshot.totalBalance;
  const priceUsd = snapshot.priceUsd;
  const totalBalanceUsd = totalBalance * priceUsd;

  // Net flows over windows
  const latestBalance = history30.at(-1)?.totalBalance ?? totalBalance;
  const balance1dAgo = history30.length >= 2 ? history30.at(-2)!.totalBalance : latestBalance;
  const balance7dAgo =
    history30.length >= 8 ? history30.at(-8)!.totalBalance : (history30.at(0)?.totalBalance ?? latestBalance);
  const balance30dAgo = history30.at(0)?.totalBalance ?? latestBalance;

  const netFlow1d = latestBalance - balance1dAgo;
  const netFlow7d = latestBalance - balance7dAgo;
  const netFlow30d = latestBalance - balance30dAgo;

  // Percentage changes
  const reserveChange1dPct = balance1dAgo > 0 ? (netFlow1d / balance1dAgo) * 100 : 0;
  const reserveChange7dPct = balance7dAgo > 0 ? (netFlow7d / balance7dAgo) * 100 : 0;
  const reserveChange30dPct = balance30dAgo > 0 ? (netFlow30d / balance30dAgo) * 100 : 0;

  // Statistical context on daily deltas
  const deltaValues = deltas.map((d) => d.delta);
  const dailyFlowMean30d = deltaValues.length > 0 ? deltaValues.reduce((s, v) => s + v, 0) / deltaValues.length : 0;
  const variance =
    deltaValues.length > 0 ? deltaValues.reduce((s, v) => s + (v - dailyFlowMean30d) ** 2, 0) / deltaValues.length : 0;
  const dailyFlowSigma30d = Math.sqrt(variance);

  const todayDelta = deltaValues.at(-1) ?? 0;
  const todaySigma = dailyFlowSigma30d > 0 ? (todayDelta - dailyFlowMean30d) / dailyFlowSigma30d : 0;

  const flowPercentile1m =
    deltaValues.length > 0
      ? Math.round((deltaValues.filter((v) => v < todayDelta).length / deltaValues.length) * 100)
      : 50;

  // Balance trend: compare last 7 data points
  const recentHistory = history30.slice(-7);
  let balanceTrend: ExchangeFlowsMetrics["balanceTrend"] = "FLAT";
  if (recentHistory.length >= 3) {
    const first = recentHistory[0]!.totalBalance;
    const last = recentHistory.at(-1)!.totalBalance;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    if (changePct > 0.5) balanceTrend = "RISING";
    else if (changePct < -0.5) balanceTrend = "FALLING";
  }

  // 30d extremes
  const allBalances = history30.map((p) => p.totalBalance);
  const min30d = Math.min(...allBalances);
  const max30d = Math.max(...allBalances);
  const isAt30dLow = allBalances.length > 0 && latestBalance <= min30d * 1.005; // within 0.5%
  const isAt30dHigh = allBalances.length > 0 && latestBalance >= max30d * 0.995;

  // Top exchanges
  const topExchanges = snapshot.currentBalances.slice(0, 5).map((e) => ({
    exchange: e.exchange,
    balance: e.balance,
    changePct7d: e.change7dPct,
  }));

  return {
    totalBalance,
    totalBalanceUsd,
    netFlow1d,
    netFlow7d,
    netFlow30d,
    reserveChange1dPct: round(reserveChange1dPct),
    reserveChange7dPct: round(reserveChange7dPct),
    reserveChange30dPct: round(reserveChange30dPct),
    dailyFlowMean30d: round(dailyFlowMean30d),
    dailyFlowSigma30d: round(dailyFlowSigma30d),
    todaySigma: round(todaySigma),
    flowPercentile1m,
    balanceTrend,
    isAt30dLow,
    isAt30dHigh,
    topExchanges,
  };
}

function round(v: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

// ─── State machine ────────────────────────────────────────────────────────────

function determineRegime(metrics: ExchangeFlowsMetrics): ExchangeFlowsRegime {
  // Priority 1: Extreme single-day events (>95th / <5th percentile)
  if (metrics.flowPercentile1m >= 95 && metrics.todaySigma >= 2) {
    return "HEAVY_INFLOW";
  }
  if (metrics.flowPercentile1m <= 5 && metrics.todaySigma <= -2) {
    return "HEAVY_OUTFLOW";
  }

  // Priority 2: Sustained 7d flow direction + reserve trend confirmation
  if (metrics.netFlow7d < 0 && metrics.balanceTrend === "FALLING") {
    return "ACCUMULATION";
  }
  if (metrics.netFlow7d > 0 && metrics.balanceTrend === "RISING") {
    return "DISTRIBUTION";
  }

  // Priority 3: 30d low/high as tiebreaker
  if (metrics.isAt30dLow && metrics.netFlow30d < 0) {
    return "ACCUMULATION";
  }
  if (metrics.isAt30dHigh && metrics.netFlow30d > 0) {
    return "DISTRIBUTION";
  }

  return "EF_NEUTRAL";
}

// ─── Event detection ──────────────────────────────────────────────────────────

function detectEvents(snapshot: ExchangeFlowsSnapshot, metrics: ExchangeFlowsMetrics): ExchangeFlowsEvent[] {
  const events: ExchangeFlowsEvent[] = [];

  if (metrics.todaySigma >= 2) {
    events.push({
      type: "heavy_inflow",
      detail: `${formatAsset(Math.abs(metrics.netFlow1d), snapshot.asset)} inflow — ${metrics.todaySigma.toFixed(1)}σ from 30d mean`,
      at: snapshot.timestamp,
    });
  }

  if (metrics.todaySigma <= -2) {
    events.push({
      type: "heavy_outflow",
      detail: `${formatAsset(Math.abs(metrics.netFlow1d), snapshot.asset)} outflow — ${Math.abs(metrics.todaySigma).toFixed(1)}σ from 30d mean`,
      at: snapshot.timestamp,
    });
  }

  if (metrics.isAt30dLow) {
    events.push({
      type: "reserve_low",
      detail: `Exchange reserves at 30d low: ${formatAsset(metrics.totalBalance, snapshot.asset)}`,
      at: snapshot.timestamp,
    });
  }

  if (metrics.isAt30dHigh) {
    events.push({
      type: "reserve_high",
      detail: `Exchange reserves at 30d high: ${formatAsset(metrics.totalBalance, snapshot.asset)}`,
      at: snapshot.timestamp,
    });
  }

  return events;
}

function formatAsset(v: number, asset: string): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M ${asset}`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K ${asset}`;
  return `${v.toFixed(2)} ${asset}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyze(
  snapshot: ExchangeFlowsSnapshot,
  prevState: ExchangeFlowsState | null,
): { context: ExchangeFlowsContext; nextState: ExchangeFlowsState } {
  const metrics = computeMetrics(snapshot);
  const regime = determineRegime(metrics);

  const since = prevState?.regime === regime ? prevState.since : snapshot.timestamp;
  const now = new Date(snapshot.timestamp);
  const durationDays = Math.max(0, Math.round((now.getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)));
  const previousRegime =
    prevState?.regime !== regime ? (prevState?.regime ?? null) : (prevState?.previousRegime ?? null);

  const events = detectEvents(snapshot, metrics);

  const context: ExchangeFlowsContext = {
    asset: snapshot.asset,
    regime,
    since,
    durationDays,
    previousRegime,
    metrics,
    events,
  };

  const nextState: ExchangeFlowsState = {
    asset: snapshot.asset,
    regime,
    since,
    previousRegime,
    lastUpdated: snapshot.timestamp,
  };

  return { context, nextState };
}
