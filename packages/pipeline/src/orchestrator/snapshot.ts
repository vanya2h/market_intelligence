/**
 * Orchestrator — Hourly Snapshot Job (no LLM)
 *
 * Runs collect + analyze for every dimension and persists the result to the
 * per-dim `<dim>_snapshots` table plus the mutable `dimension_states` row.
 * No agent / synthesizer / Telegram calls — this is the deterministic feed
 * the ML model trains on and that brief generation reads from.
 *
 * Cadence: top of every hour (see scheduler.ts). Brief generation runs at :05
 * so it can read the snapshot we just wrote.
 *
 * Public API:
 *   snapshotAllDimensions(asset)  — collect + analyze + persist for all dims
 *   loadLatestSnapshots(asset, freshnessMs?) — read latest rows for brief tick
 */
import chalk from "chalk";
import { analyze as analyzeDerivatives } from "../derivatives_structure/analyzer.js";
import { collect as collectDerivatives } from "../derivatives_structure/collector.js";
import { analyze as analyzeEtfs } from "../etfs/analyzer.js";
import { collect as collectEtfs } from "../etfs/collector.js";
import type { EtfState } from "../etfs/types.js";
import { analyze as analyzeExchangeFlows } from "../exchange_flows/analyzer.js";
import { collect as collectExchangeFlows } from "../exchange_flows/collector.js";
import type { ExchangeFlowsState } from "../exchange_flows/types.js";
import type { Prisma } from "../generated/prisma/client.js";
import { analyze as analyzeHtf } from "../htf/analyzer.js";
import { collect as collectHtf } from "../htf/collector.js";
import type { HtfState } from "../htf/types.js";
import { analyze as analyzeSentiment } from "../sentiment/analyzer.js";
import { collect as collectSentiment } from "../sentiment/collector.js";
import type { SentimentState } from "../sentiment/types.js";
import { prisma } from "../storage/db.js";
import { loadState as loadDerivativesState, saveState as saveDerivativesState } from "../storage/json.js";
import type { AssetType } from "../types.js";
import { loadJsonState, saveJsonState } from "./dimension-state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

function getNum(obj: unknown, path: string): number | null {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

// ─── Per-dimension snapshots ────────────────────────────────────────────────

export async function snapshotDerivatives(asset: AssetType, timestamp = new Date()): Promise<string> {
  const snapshot = await collectDerivatives(asset);
  const prevState = await loadDerivativesState(asset);
  const { context, nextState } = analyzeDerivatives(snapshot, prevState);
  await saveDerivativesState(asset, nextState);
  const row = await prisma.derivativesSnapshot.upsert({
    where: { asset_timestamp: { asset, timestamp } },
    create: {
      asset,
      timestamp,
      regime: context.positioning.state,
      stress: context.stress.state,
      previousRegime: context.previousPositioning,
      previousStress: context.previousStress,
      oiSignal: context.oiSignal,
      since: new Date(context.since),
      fundingPct1m: getNum(context, "signals.fundingPct1m"),
      oiZScore30d: getNum(context, "signals.oiZScore30d"),
      oiChange24h: getNum(context, "signals.oiChange24h"),
      oiChange7d: getNum(context, "signals.oiChange7d"),
      liqPct1m: getNum(context, "signals.liqPct1m"),
      fundingPressureCycles: getNum(context, "signals.fundingPressureCycles"),
      fundingCurrent: getNum(context, "funding.current"),
      fundingPercentile1m: getNum(context, "funding.percentile.1m"),
      oiCurrent: getNum(context, "openInterest.current"),
      oiPercentile1m: getNum(context, "openInterest.percentile.1m"),
      liq8h: getNum(context, "liquidations.current8h"),
      cbPremiumCurrent: getNum(context, "coinbasePremium.current"),
      cbPremiumPercentile1m: getNum(context, "coinbasePremium.percentile.1m"),
      context: asJson(context),
    },
    update: { context: asJson(context) },
  });
  return row.id;
}

export async function snapshotEtfs(asset: AssetType, timestamp = new Date()): Promise<string> {
  const snapshot = await collectEtfs(asset);
  const prevState = loadJsonState<EtfState>("etfs_state.json", asset);
  const { context, nextState } = analyzeEtfs(snapshot, prevState);
  saveJsonState("etfs_state.json", asset, nextState);
  const row = await prisma.etfsSnapshot.upsert({
    where: { asset_timestamp: { asset, timestamp } },
    create: {
      asset,
      timestamp,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: new Date(context.since),
      flowTodaySigma: getNum(context, "flow.todaySigma"),
      flowPercentile1m: getNum(context, "flow.percentile1m"),
      flowToday: getNum(context, "flow.today"),
      flowD3Sum: getNum(context, "flow.d3Sum"),
      flowD7Sum: getNum(context, "flow.d7Sum"),
      consecutiveInflowDays: getNum(context, "flow.consecutiveInflowDays"),
      consecutiveOutflowDays: getNum(context, "flow.consecutiveOutflowDays"),
      reversalRatio: getNum(context, "flow.reversalRatio"),
      totalAumUsd: getNum(context, "totalAumUsd"),
      context: asJson(context),
    },
    update: { context: asJson(context) },
  });
  return row.id;
}

export async function snapshotHtf(asset: AssetType, timestamp = new Date()): Promise<string> {
  const snapshot = await collectHtf(asset);
  const prevState = loadJsonState<HtfState>("htf_state.json", asset);
  const { context, nextState } = analyzeHtf(snapshot, prevState);
  saveJsonState("htf_state.json", asset, nextState);
  const row = await prisma.htfSnapshot.upsert({
    where: { asset_timestamp: { asset, timestamp } },
    create: {
      asset,
      timestamp,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: new Date(context.since),
      lastStructure: context.structure,
      snapshotPrice: context.price,
      priceVsSma50Pct: getNum(context, "ma.priceVsSma50Pct"),
      priceVsSma200Pct: getNum(context, "ma.priceVsSma200Pct"),
      rsiDaily: getNum(context, "rsi.daily"),
      rsiH4: getNum(context, "rsi.h4"),
      cvdFutShortSlope: getNum(context, "cvd.futures.short.slope"),
      cvdFutShortR2: getNum(context, "cvd.futures.short.r2"),
      cvdFutLongSlope: getNum(context, "cvd.futures.long.slope"),
      cvdSpotShortSlope: getNum(context, "cvd.spot.short.slope"),
      cvdSpotLongSlope: getNum(context, "cvd.spot.long.slope"),
      atrPercentile: getNum(context, "volatility.atrPercentile"),
      atrRatio: getNum(context, "volatility.atrRatio"),
      recentDisplacement: getNum(context, "volatility.recentDisplacement"),
      priceVsPocPct: getNum(context, "volumeProfile.profile.priceVsPocPct"),
      context: asJson(context),
    },
    update: { context: asJson(context) },
  });
  return row.id;
}

export async function snapshotSentiment(asset: AssetType, timestamp = new Date()): Promise<string> {
  const snapshot = await collectSentiment(asset);
  const prevState = loadJsonState<SentimentState>("sentiment_state.json", asset);
  const { context, nextState } = analyzeSentiment(snapshot, prevState);
  saveJsonState("sentiment_state.json", asset, nextState);
  const row = await prisma.sentimentSnapshot.upsert({
    where: { asset_timestamp: { asset, timestamp } },
    create: {
      asset,
      timestamp,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: new Date(context.since),
      compositeIndex: context.metrics.compositeIndex,
      compositeLabel: context.metrics.compositeLabel,
      positioning: context.metrics.components.positioning,
      trend: context.metrics.components.trend,
      momentumDivergence: getNum(context, "metrics.components.momentumDivergence"),
      institutionalFlows: context.metrics.components.institutionalFlows,
      exchangeFlows: context.metrics.components.exchangeFlows,
      expertConsensus: null, // hidden while collecting delta-based data (re-enable ~2026-04-02)
      consensusIndex: getNum(context, "metrics.consensusIndex"),
      sentZScore: getNum(context, "metrics.zScore"),
      bullishRatio: getNum(context, "metrics.bullishRatio"),
      context: asJson(context),
    },
    update: { context: asJson(context) },
  });
  return row.id;
}

export async function snapshotExchangeFlows(asset: AssetType, timestamp = new Date()): Promise<string> {
  const snapshot = await collectExchangeFlows(asset);
  const prevState = loadJsonState<ExchangeFlowsState>("exchange_flows_state.json", asset);
  const { context, nextState } = analyzeExchangeFlows(snapshot, prevState);
  saveJsonState("exchange_flows_state.json", asset, nextState);
  const row = await prisma.exchangeFlowsSnapshot.upsert({
    where: { asset_timestamp: { asset, timestamp } },
    create: {
      asset,
      timestamp,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: new Date(context.since),
      flowTodaySigma: getNum(context, "metrics.todaySigma"),
      flowPercentile1m: getNum(context, "metrics.flowPercentile1m"),
      reserveChange1dPct: getNum(context, "metrics.reserveChange1dPct"),
      reserveChange7dPct: getNum(context, "metrics.reserveChange7dPct"),
      reserveChange30dPct: getNum(context, "metrics.reserveChange30dPct"),
      netFlow1d: getNum(context, "metrics.netFlow1d"),
      netFlow7d: getNum(context, "metrics.netFlow7d"),
      context: asJson(context),
    },
    update: { context: asJson(context) },
  });
  return row.id;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface SnapshotResult {
  asset: AssetType;
  derivativesId: string | null;
  etfsId: string | null;
  htfId: string | null;
  sentimentId: string | null;
  exchangeFlowsId: string | null;
}

/**
 * Run all dimension snapshots in parallel. A failure in one dim is logged and
 * does NOT abort the others — the snapshot table simply keeps the older row
 * for that dim, and brief generation can fall back accordingly.
 */
export async function snapshotAllDimensions(asset: AssetType, timestamp = new Date()): Promise<SnapshotResult> {
  const [derivatives, etfs, htf, sentiment, exchangeFlows] = await Promise.allSettled([
    snapshotDerivatives(asset, timestamp),
    snapshotEtfs(asset, timestamp),
    snapshotHtf(asset, timestamp),
    snapshotSentiment(asset, timestamp),
    snapshotExchangeFlows(asset, timestamp),
  ]);

  const result: SnapshotResult = {
    asset,
    derivativesId: derivatives.status === "fulfilled" ? derivatives.value : null,
    etfsId: etfs.status === "fulfilled" ? etfs.value : null,
    htfId: htf.status === "fulfilled" ? htf.value : null,
    sentimentId: sentiment.status === "fulfilled" ? sentiment.value : null,
    exchangeFlowsId: exchangeFlows.status === "fulfilled" ? exchangeFlows.value : null,
  };

  for (const [name, r] of [
    ["derivatives", derivatives],
    ["etfs", etfs],
    ["htf", htf],
    ["sentiment", sentiment],
    ["exchange_flows", exchangeFlows],
  ] as const) {
    if (r.status === "rejected") {
      console.log(`      ${chalk.red("✗")} ${name} (${asset}): ${(r.reason as Error).message}`);
    } else {
      console.log(`      ${chalk.green("✓")} ${name} (${asset})`);
    }
  }

  return result;
}
