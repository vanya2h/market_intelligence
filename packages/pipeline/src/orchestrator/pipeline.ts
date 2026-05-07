/**
 * Orchestrator — Brief-side Dimension Runner
 *
 * Reads the latest snapshot row per dimension (written by the hourly snapshot
 * job in orchestrator/snapshot.ts), runs each agent on the snapshot's analyzer
 * context, and returns DimensionOutput[] for the synthesizer.
 *
 * If a snapshot is missing or older than SNAPSHOT_FRESHNESS_MS we fall back
 * to a live snapshot run for that dim — that path also writes a fresh row,
 * so the next brief tick will see it.
 */

import chalk from "chalk";
import { runAgent as runDerivativesAgent } from "../derivatives_structure/agent.js";
import { runAgent as runEtfsAgent } from "../etfs/agent.js";
import { runAgent as runExchangeFlowsAgent } from "../exchange_flows/agent.js";
import type { ExchangeFlowsContext } from "../exchange_flows/types.js";
import { runAgent as runHtfAgent } from "../htf/agent.js";
import type { HtfContext } from "../htf/types.js";
import { runAgent as runSentimentAgent } from "../sentiment/agent.js";
import type { SentimentContext } from "../sentiment/types.js";
import { prisma } from "../storage/db.js";
import type { AssetType, DerivativesContext } from "../types.js";
import type { EtfContext } from "../etfs/types.js";
import {
  snapshotDerivatives,
  snapshotEtfs,
  snapshotExchangeFlows,
  snapshotHtf,
  snapshotSentiment,
} from "./snapshot.js";
import type {
  DerivativesOutput,
  DimensionOutput,
  EtfsOutput,
  ExchangeFlowsOutput,
  HtfOutput,
  SentimentOutput,
} from "./types.js";

/** Brief tick reuses a snapshot if it's at most this old. Snapshot cron is
 *  hourly at :00 and brief cron is :05, so 10 min is plenty for the normal
 *  path and small enough to force a fresh fetch when the snapshot job missed. */
const SNAPSHOT_FRESHNESS_MS = 10 * 60 * 1000;

function isFresh(timestamp: Date): boolean {
  return Date.now() - timestamp.getTime() <= SNAPSHOT_FRESHNESS_MS;
}

// ─── Per-dim brief runners ───────────────────────────────────────────────────

async function runDerivatives(asset: AssetType): Promise<DerivativesOutput | null> {
  try {
    let row = await prisma.derivativesSnapshot.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
    });
    if (!row || !isFresh(row.timestamp)) {
      console.log(`      ${chalk.yellow("⟳")} derivatives (${asset}) snapshot stale — refreshing`);
      const id = await snapshotDerivatives(asset);
      row = await prisma.derivativesSnapshot.findUniqueOrThrow({ where: { id } });
    } else {
      console.log(`      ${chalk.cyan("▸")} derivatives (${asset}) reading snapshot`);
    }
    const context = row.context as unknown as DerivativesContext;
    const interpretation = await runDerivativesAgent(context);
    return {
      dimension: "DERIVATIVES",
      snapshotId: row.id,
      regime: context.positioning.state,
      stress: context.stress.state,
      previousRegime: context.previousPositioning,
      previousStress: context.previousStress,
      oiSignal: context.oiSignal,
      since: context.since,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} derivatives: ${(e as Error).message}`);
    return null;
  }
}

async function runEtfs(asset: AssetType): Promise<EtfsOutput | null> {
  try {
    let row = await prisma.etfsSnapshot.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
    });
    if (!row || !isFresh(row.timestamp)) {
      console.log(`      ${chalk.yellow("⟳")} etfs (${asset}) snapshot stale — refreshing`);
      const id = await snapshotEtfs(asset);
      row = await prisma.etfsSnapshot.findUniqueOrThrow({ where: { id } });
    } else {
      console.log(`      ${chalk.cyan("▸")} etfs (${asset}) reading snapshot`);
    }
    const context = row.context as unknown as EtfContext;
    const interpretation = await runEtfsAgent(context);
    return {
      dimension: "ETFS",
      snapshotId: row.id,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: context.since,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} etfs: ${(e as Error).message}`);
    return null;
  }
}

async function runHtf(asset: AssetType): Promise<HtfOutput | null> {
  try {
    let row = await prisma.htfSnapshot.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
    });
    if (!row || !isFresh(row.timestamp)) {
      console.log(`      ${chalk.yellow("⟳")} htf (${asset}) snapshot stale — refreshing`);
      const id = await snapshotHtf(asset);
      row = await prisma.htfSnapshot.findUniqueOrThrow({ where: { id } });
    } else {
      console.log(`      ${chalk.cyan("▸")} htf (${asset}) reading snapshot`);
    }
    const context = row.context as unknown as HtfContext;
    const interpretation = await runHtfAgent(context);
    return {
      dimension: "HTF",
      snapshotId: row.id,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: context.since,
      lastStructure: context.structure,
      snapshotPrice: context.price,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} htf: ${(e as Error).message}`);
    return null;
  }
}

async function runSentimentDim(asset: AssetType): Promise<SentimentOutput | null> {
  try {
    let row = await prisma.sentimentSnapshot.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
    });
    if (!row || !isFresh(row.timestamp)) {
      console.log(`      ${chalk.yellow("⟳")} sentiment (${asset}) snapshot stale — refreshing`);
      const id = await snapshotSentiment(asset);
      row = await prisma.sentimentSnapshot.findUniqueOrThrow({ where: { id } });
    } else {
      console.log(`      ${chalk.cyan("▸")} sentiment (${asset}) reading snapshot`);
    }
    const context = row.context as unknown as SentimentContext;
    const interpretation = await runSentimentAgent(context);
    return {
      dimension: "SENTIMENT",
      snapshotId: row.id,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: context.since,
      compositeIndex: context.metrics.compositeIndex,
      compositeLabel: context.metrics.compositeLabel,
      positioning: context.metrics.components.positioning,
      trend: context.metrics.components.trend,
      institutionalFlows: context.metrics.components.institutionalFlows,
      exchangeFlows: context.metrics.components.exchangeFlows,
      expertConsensus: null, // hidden while collecting delta-based data (re-enable ~2026-04-02)
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} sentiment: ${(e as Error).message}`);
    return null;
  }
}

async function runExchangeFlowsDim(asset: AssetType): Promise<ExchangeFlowsOutput | null> {
  try {
    let row = await prisma.exchangeFlowsSnapshot.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
    });
    if (!row || !isFresh(row.timestamp)) {
      console.log(`      ${chalk.yellow("⟳")} exchange flows (${asset}) snapshot stale — refreshing`);
      const id = await snapshotExchangeFlows(asset);
      row = await prisma.exchangeFlowsSnapshot.findUniqueOrThrow({ where: { id } });
    } else {
      console.log(`      ${chalk.cyan("▸")} exchange flows (${asset}) reading snapshot`);
    }
    const context = row.context as unknown as ExchangeFlowsContext;
    const interpretation = await runExchangeFlowsAgent(context);
    return {
      dimension: "EXCHANGE_FLOWS",
      snapshotId: row.id,
      regime: context.regime,
      previousRegime: context.previousRegime,
      since: context.since,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} exchange flows: ${(e as Error).message}`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all dimension agents for an asset, reading from the latest snapshots
 * (and refreshing them when stale). Returns only successful outputs.
 */
export async function runAllDimensions(asset: AssetType): Promise<DimensionOutput[]> {
  const results = await Promise.all([
    runDerivatives(asset),
    runEtfs(asset),
    runHtf(asset),
    runExchangeFlowsDim(asset),
    runSentimentDim(asset),
  ]);

  return results.filter((r): r is DimensionOutput => r !== null);
}
