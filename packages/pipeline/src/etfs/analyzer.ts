/**
 * ETF Flows — Deterministic Analyzer (Dimension 03)
 *
 * Transition rules:
 *   3+ consecutive outflow days                        → STRONG_OUTFLOW
 *   3+ consecutive inflow days                         → STRONG_INFLOW
 *   2+ inflow days after STRONG_OUTFLOW                → REVERSAL_TO_INFLOW
 *   2+ outflow days after STRONG_INFLOW                → REVERSAL_TO_OUTFLOW
 *   else                                               → NEUTRAL
 *
 * Events:
 *   today > mean + 2σ                                  → sigma_inflow
 *   today < mean - 2σ                                  → sigma_outflow
 *   GBTC premium_rate < -3%                            → gbtc_discount
 *   GBTC premium_rate > +3%                            → gbtc_premium
 */

import {
  EtfSnapshot,
  EtfContext,
  EtfRegime,
  EtfState,
  EtfFlowDay,
  EtfFlowMetrics,
  EtfEvent,
} from "./types.js";

// ─── Flow metrics ─────────────────────────────────────────────────────────────

function last30Days(history: EtfFlowDay[], now: Date): EtfFlowDay[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  return history.filter((d) => new Date(d.date) >= cutoff);
}

function computeFlowMetrics(history: EtfFlowDay[]): EtfFlowMetrics {
  if (history.length === 0) {
    return {
      today: 0, d3Sum: 0, d7Sum: 0, d30Sum: 0,
      consecutiveOutflowDays: 0, consecutiveInflowDays: 0,
      mean30d: 0, sigma30d: 0, todaySigma: 0, percentile1m: 50,
    };
  }

  // Skip days with zero flow — data hasn't arrived yet (ETF data published after US market close)
  const sorted = [...history]
    .filter((d) => d.flowUsd !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const today = sorted.at(-1)!.flowUsd;
  const d3Sum = sorted.slice(-3).reduce((s, d) => s + d.flowUsd, 0);
  const d7Sum = sorted.slice(-7).reduce((s, d) => s + d.flowUsd, 0);
  const d30Sum = sorted.reduce((s, d) => s + d.flowUsd, 0);

  const values = sorted.map((d) => d.flowUsd);
  const mean30d = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean30d) ** 2, 0) / values.length;
  const sigma30d = Math.sqrt(variance);
  const todaySigma = sigma30d > 0 ? (today - mean30d) / sigma30d : 0;
  const percentile1m = Math.round((values.filter((v) => v < today).length / values.length) * 100);

  // Count consecutive streak from the most recent day backward
  let consecutiveOutflowDays = 0;
  let consecutiveInflowDays = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const flow = sorted[i]!.flowUsd;
    if (flow < 0) {
      if (consecutiveInflowDays > 0) break;
      consecutiveOutflowDays++;
    } else {
      if (consecutiveOutflowDays > 0) break;
      consecutiveInflowDays++;
    }
  }

  return {
    today, d3Sum, d7Sum, d30Sum,
    consecutiveOutflowDays, consecutiveInflowDays,
    mean30d, sigma30d, todaySigma, percentile1m,
  };
}

// ─── State machine ────────────────────────────────────────────────────────────

function determineRegime(metrics: EtfFlowMetrics, prevRegime: EtfRegime | null): EtfRegime {
  const { consecutiveOutflowDays, consecutiveInflowDays } = metrics;

  if (consecutiveOutflowDays >= 3) {
    if (prevRegime === "STRONG_INFLOW" || prevRegime === "REVERSAL_TO_INFLOW") return "REVERSAL_TO_OUTFLOW";
    return "STRONG_OUTFLOW";
  }

  if (consecutiveInflowDays >= 3) {
    if (prevRegime === "STRONG_OUTFLOW" || prevRegime === "REVERSAL_TO_OUTFLOW") return "REVERSAL_TO_INFLOW";
    return "STRONG_INFLOW";
  }

  if (consecutiveInflowDays >= 2 && (prevRegime === "STRONG_OUTFLOW" || prevRegime === "REVERSAL_TO_OUTFLOW")) {
    return "REVERSAL_TO_INFLOW";
  }

  if (consecutiveOutflowDays >= 2 && (prevRegime === "STRONG_INFLOW" || prevRegime === "REVERSAL_TO_INFLOW")) {
    return "REVERSAL_TO_OUTFLOW";
  }

  return "NEUTRAL";
}

// ─── Event detection ──────────────────────────────────────────────────────────

function detectEvents(snapshot: EtfSnapshot, metrics: EtfFlowMetrics): EtfEvent[] {
  const events: EtfEvent[] = [];

  if (Math.abs(metrics.todaySigma) >= 2) {
    const isInflow = metrics.today > 0;
    events.push({
      type: isInflow ? "sigma_inflow" : "sigma_outflow",
      detail: `${formatUsd(Math.abs(metrics.today))} ${isInflow ? "inflow" : "outflow"} — ${Math.abs(metrics.todaySigma).toFixed(1)}σ from 30d mean`,
      at: snapshot.timestamp,
    });
  }

  if (snapshot.gbtcPremiumRate !== undefined) {
    if (snapshot.gbtcPremiumRate < -3) {
      events.push({
        type: "gbtc_discount",
        detail: `GBTC at ${snapshot.gbtcPremiumRate.toFixed(2)}% discount`,
        at: snapshot.timestamp,
      });
    } else if (snapshot.gbtcPremiumRate > 3) {
      events.push({
        type: "gbtc_premium",
        detail: `GBTC at +${snapshot.gbtcPremiumRate.toFixed(2)}% premium`,
        at: snapshot.timestamp,
      });
    }
  }

  return events;
}

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyze(
  snapshot: EtfSnapshot,
  prevState: EtfState | null
): { context: EtfContext; nextState: EtfState } {
  const now = new Date(snapshot.timestamp);
  const history30 = last30Days(snapshot.flowHistory, now);
  const metrics = computeFlowMetrics(history30);
  const regime = determineRegime(metrics, prevState?.regime ?? null);

  const since = prevState?.regime === regime ? prevState.since : snapshot.timestamp;
  const durationDays = Math.max(
    0,
    Math.round((now.getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24))
  );
  const previousRegime =
    prevState?.regime !== regime
      ? (prevState?.regime ?? null)
      : (prevState?.previousRegime ?? null);

  const events = detectEvents(snapshot, metrics);

  const context: EtfContext = {
    asset: snapshot.asset,
    regime,
    since,
    durationDays,
    previousRegime,
    flow: metrics,
    totalAumUsd: snapshot.totalAumUsd,
    gbtcPremiumRate: snapshot.gbtcPremiumRate,
    events,
  };

  const nextState: EtfState = {
    asset: snapshot.asset,
    regime,
    since,
    previousRegime,
    lastUpdated: snapshot.timestamp,
  };

  return { context, nextState };
}
