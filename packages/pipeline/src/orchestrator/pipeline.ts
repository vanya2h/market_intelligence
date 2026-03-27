/**
 * Orchestrator — Dimension Pipeline Runner
 *
 * Runs all implemented dimensions (collect → analyze → agent) in parallel
 * and returns their outputs for the orchestrator LLM to synthesize.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { collect as collectDerivatives } from "../derivatives_structure/collector.js";
import { analyze as analyzeDerivatives } from "../derivatives_structure/analyzer.js";
import { runAgent as runDerivativesAgent } from "../derivatives_structure/agent.js";
import {
  appendSnapshot,
  loadState as loadDerivativesState,
  saveState as saveDerivativesState,
} from "../storage/json.js";

import { collect as collectEtfs } from "../etfs/collector.js";
import { analyze as analyzeEtfs } from "../etfs/analyzer.js";
import { runAgent as runEtfsAgent } from "../etfs/agent.js";
import type { EtfState } from "../etfs/types.js";

import { collect as collectHtf } from "../htf/collector.js";
import { analyze as analyzeHtf } from "../htf/analyzer.js";
import { runAgent as runHtfAgent } from "../htf/agent.js";
import type { HtfState } from "../htf/types.js";

import { collect as collectSentiment } from "../sentiment/collector.js";
import { analyze as analyzeSentiment } from "../sentiment/analyzer.js";
import { runAgent as runSentimentAgent } from "../sentiment/agent.js";
import type { SentimentState } from "../sentiment/types.js";

import { collect as collectExchangeFlows } from "../exchange_flows/collector.js";
import { analyze as analyzeExchangeFlows } from "../exchange_flows/analyzer.js";
import { runAgent as runExchangeFlowsAgent } from "../exchange_flows/agent.js";
import type { ExchangeFlowsState } from "../exchange_flows/types.js";

import type { DimensionOutput, DerivativesOutput, EtfsOutput, HtfOutput, SentimentOutput, ExchangeFlowsOutput } from "./types.js";

// ─── State helpers ───────────────────────────────────────────────────────────

function loadJsonState<T>(file: string, key?: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  return key ? (all[key] ?? null) : all;
}

function saveJsonState<T>(file: string, key: string, state: T): void {
  const fullPath = path.resolve("data", file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const all = fs.existsSync(fullPath) ? JSON.parse(fs.readFileSync(fullPath, "utf-8")) : {};
  all[key] = state;
  fs.writeFileSync(fullPath, JSON.stringify(all, null, 2));
}

// ─── Dimension runners ───────────────────────────────────────────────────────

async function runDerivatives(asset: "BTC" | "ETH"): Promise<DerivativesOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} derivatives (${asset})...`);
    const snapshot = await collectDerivatives(asset);
    const history = await appendSnapshot(asset, snapshot);
    const prevState = await loadDerivativesState(asset);
    const { context, nextState } = analyzeDerivatives(snapshot, prevState);
    saveDerivativesState(asset, nextState);
    const interpretation = await runDerivativesAgent(context);
    return {
      dimension: "DERIVATIVES",
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

async function runEtfs(asset: "BTC" | "ETH"): Promise<EtfsOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} etfs (${asset})...`);
    const snapshot = await collectEtfs(asset);
    const prevState = loadJsonState<EtfState>("etfs_state.json", asset);
    const { context, nextState } = analyzeEtfs(snapshot, prevState);
    saveJsonState("etfs_state.json", asset, nextState);
    const interpretation = await runEtfsAgent(context);
    return {
      dimension: "ETFS",
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

async function runHtf(asset: "BTC" | "ETH"): Promise<HtfOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} htf (${asset})...`);
    const snapshot = await collectHtf(asset);
    const prevState = loadJsonState<HtfState>("htf_state.json", asset);
    const { context, nextState } = analyzeHtf(snapshot, prevState);
    saveJsonState("htf_state.json", asset, nextState);
    const interpretation = await runHtfAgent(context);
    return {
      dimension: "HTF",
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

async function runSentimentDim(asset: "BTC" | "ETH"): Promise<SentimentOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} sentiment (${asset})...`);
    const snapshot = await collectSentiment(asset);
    const prevState = loadJsonState<SentimentState>("sentiment_state.json", asset);
    const { context, nextState } = analyzeSentiment(snapshot, prevState);
    saveJsonState("sentiment_state.json", asset, nextState);
    const interpretation = await runSentimentAgent(context);
    return {
      dimension: "SENTIMENT",
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

async function runExchangeFlowsDim(asset: "BTC" | "ETH"): Promise<ExchangeFlowsOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} exchange flows (${asset})...`);
    const snapshot = await collectExchangeFlows(asset);
    const prevState = loadJsonState<ExchangeFlowsState>("exchange_flows_state.json", asset);
    const { context, nextState } = analyzeExchangeFlows(snapshot, prevState);
    saveJsonState("exchange_flows_state.json", asset, nextState);
    const interpretation = await runExchangeFlowsAgent(context);
    return {
      dimension: "EXCHANGE_FLOWS",
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
 * Run all implemented dimension pipelines in parallel for a given asset.
 * Returns only successful outputs (failed dimensions are logged and skipped).
 */
export async function runAllDimensions(asset: "BTC" | "ETH"): Promise<DimensionOutput[]> {
  const results = await Promise.all([
    runDerivatives(asset),
    runEtfs(asset),
    runHtf(asset),
    runExchangeFlowsDim(asset),
    runSentimentDim(asset),
  ]);

  return results.filter((r): r is DimensionOutput => r !== null);
}
