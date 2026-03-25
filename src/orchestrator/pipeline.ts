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
import { appendSnapshot, loadState as loadDerivativesState, saveState as saveDerivativesState } from "../storage/json.js";
import type { DerivativesState } from "../types.js";

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

import type { DimensionOutput } from "./types.js";

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
  const all = fs.existsSync(fullPath)
    ? JSON.parse(fs.readFileSync(fullPath, "utf-8"))
    : {};
  all[key] = state;
  fs.writeFileSync(fullPath, JSON.stringify(all, null, 2));
}

// ─── Dimension runners ───────────────────────────────────────────────────────

async function runDerivatives(asset: "BTC" | "ETH"): Promise<DimensionOutput | null> {
  if (asset !== "BTC") return null; // derivatives collector is BTC-only for now

  try {
    console.log(`      ${chalk.cyan("▸")} derivatives...`);
    const snapshot = await collectDerivatives();
    const history = appendSnapshot(snapshot);
    const prevState = loadDerivativesState();
    const { context, nextState } = analyzeDerivatives(snapshot, prevState);
    saveDerivativesState(nextState);
    const interpretation = await runDerivativesAgent(context);
    return {
      dimension: "derivatives",
      label: "Derivatives Structure",
      regime: `${context.regime} [OI:${context.oiSignal}]`,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} derivatives: ${(e as Error).message}`);
    return null;
  }
}

async function runEtfs(asset: "BTC" | "ETH"): Promise<DimensionOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} etfs (${asset})...`);
    const snapshot = await collectEtfs(asset);
    const prevState = loadJsonState<EtfState>("etfs_state.json", asset);
    const { context, nextState } = analyzeEtfs(snapshot, prevState);
    saveJsonState("etfs_state.json", asset, nextState);
    const interpretation = await runEtfsAgent(context);
    return {
      dimension: "etfs",
      label: "Institutional Flows (ETFs)",
      regime: context.regime,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} etfs: ${(e as Error).message}`);
    return null;
  }
}

async function runHtf(asset: "BTC" | "ETH"): Promise<DimensionOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} htf (${asset})...`);
    const snapshot = await collectHtf(asset);
    const prevState = loadJsonState<HtfState>("htf_state.json", asset);
    const { context, nextState } = analyzeHtf(snapshot, prevState);
    saveJsonState("htf_state.json", asset, nextState);
    const interpretation = await runHtfAgent(context);
    return {
      dimension: "htf",
      label: "HTF Technical Structure",
      regime: context.regime,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} htf: ${(e as Error).message}`);
    return null;
  }
}

async function runSentimentDim(asset: "BTC" | "ETH"): Promise<DimensionOutput | null> {
  try {
    console.log(`      ${chalk.cyan("▸")} sentiment (${asset})...`);
    const snapshot = await collectSentiment(asset);
    const prevState = loadJsonState<SentimentState>("sentiment_state.json", asset);
    const { context, nextState } = analyzeSentiment(snapshot, prevState);
    saveJsonState("sentiment_state.json", asset, nextState);
    const interpretation = await runSentimentAgent(context);
    return {
      dimension: "sentiment",
      label: "Market Sentiment (Composite F&G)",
      regime: context.regime,
      context,
      interpretation,
    };
  } catch (e) {
    console.log(`      ${chalk.red("✗")} sentiment: ${(e as Error).message}`);
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
    runSentimentDim(asset),
  ]);

  return results.filter((r): r is DimensionOutput => r !== null);
}
