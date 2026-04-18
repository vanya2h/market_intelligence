/**
 * Debug script — isolates the institutional flows (ETF) indicator calculation.
 *
 * Usage:  tsx src/scripts/debug-etf.ts --asset [BTC|ETH]
 */

import fs from "node:fs";
import path from "node:path";
import { analyze as analyzeEtfs } from "../etfs/analyzer.js";
import { collect as collectEtfs } from "../etfs/collector.js";
import type { EtfState } from "../etfs/types.js";
import { parseAsset } from "./utils.js";
import "../env.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function label(score: number): string {
  if (score < 25) return "EXTREME FEAR";
  if (score < 40) return "FEAR";
  if (score < 60) return "NEUTRAL";
  if (score < 75) return "GREED";
  return "EXTREME GREED";
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── scoring (copied from sentiment/analyzer.ts) ────────────────────────────

function scoreInstitutionalFlows(e: {
  consecutiveInflowDays: number;
  consecutiveOutflowDays: number;
  todaySigma: number;
  regime: string;
}): { total: number; streakScore: number; sigmaScore: number; regimeBonus: number } {
  let streakScore = 50;
  if (e.consecutiveInflowDays > 0) {
    streakScore = clamp(50 + e.consecutiveInflowDays * 7);
  } else if (e.consecutiveOutflowDays > 0) {
    streakScore = clamp(50 - e.consecutiveOutflowDays * 7);
  }

  const sigmaScore = clamp(50 + e.todaySigma * 15);

  let regimeBonus = 0;
  if (e.regime === "STRONG_INFLOW") regimeBonus = 10;
  else if (e.regime === "STRONG_OUTFLOW") regimeBonus = -10;
  else if (e.regime === "REVERSAL_TO_INFLOW") regimeBonus = 5;
  else if (e.regime === "REVERSAL_TO_OUTFLOW") regimeBonus = -5;

  const total = clamp(streakScore * 0.5 + sigmaScore * 0.5 + regimeBonus);
  return { total, streakScore, sigmaScore, regimeBonus };
}

// ─── state loader ────────────────────────────────────────────────────────────

function loadDimState<T>(file: string, asset: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  return (all[asset] ?? all) as T;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  console.log(`\n🔍 ETF / Institutional Flows debug — ${asset}\n`);

  // 1. Collect & analyze
  console.log("Fetching ETF data...");
  const snapshot = await collectEtfs(asset);
  const prevState = loadDimState<EtfState>("etfs_state.json", asset);
  const { context } = analyzeEtfs(snapshot, prevState);
  const flow = context.flow;

  // 2. Score
  const inputs = {
    consecutiveInflowDays: flow.consecutiveInflowDays,
    consecutiveOutflowDays: flow.consecutiveOutflowDays,
    todaySigma: flow.todaySigma,
    regime: context.regime,
  };
  const { total, streakScore, sigmaScore, regimeBonus } = scoreInstitutionalFlows(inputs);

  // 3. Print
  console.log("─── Flow history (last 10 days) ──────────────────");
  const recent = snapshot.flowHistory.slice(-10);
  for (const day of recent) {
    const bar =
      day.flowUsd >= 0
        ? " ".repeat(20) + "█".repeat(Math.min(30, Math.round(Math.abs(day.flowUsd) / 50e6)))
        : " ".repeat(Math.max(0, 20 - Math.round(Math.abs(day.flowUsd) / 50e6))) +
          "█".repeat(Math.min(20, Math.round(Math.abs(day.flowUsd) / 50e6)));
    console.log(`  ${day.date}  ${fmtUsd(day.flowUsd).padStart(10)}  ${bar}`);
  }

  console.log("\n─── Flow metrics ─────────────────────────────────");
  console.log(`  Today                   : ${fmtUsd(flow.today)}`);
  console.log(`  3d cumulative           : ${fmtUsd(flow.d3Sum)}`);
  console.log(`  7d cumulative           : ${fmtUsd(flow.d7Sum)}`);
  console.log(`  30d cumulative          : ${fmtUsd(flow.d30Sum)}`);
  console.log(`  30d mean                : ${fmtUsd(flow.mean30d)}`);
  console.log(`  30d σ                   : ${fmtUsd(flow.sigma30d)}`);
  console.log(`  Today's σ               : ${flow.todaySigma.toFixed(2)}`);
  console.log(`  Percentile (1m)         : ${flow.percentile1m.toFixed(0)}th`);

  console.log("\n─── Streaks ──────────────────────────────────────");
  console.log(`  Consecutive inflow days : ${flow.consecutiveInflowDays}`);
  console.log(`  Consecutive outflow days: ${flow.consecutiveOutflowDays}`);
  console.log(`  Prior streak flow       : ${fmtUsd(flow.priorStreakFlow)}`);
  console.log(`  Reversal flow           : ${fmtUsd(flow.reversalFlow)}`);
  console.log(`  Reversal ratio          : ${(flow.reversalRatio * 100).toFixed(1)}%`);

  console.log("\n─── Regime ───────────────────────────────────────");
  console.log(`  Current                 : ${context.regime}`);
  console.log(`  Previous                : ${context.previousRegime ?? "—"}`);
  console.log(`  Since                   : ${context.since}`);
  console.log(`  Duration                : ${context.durationDays}d`);
  if (context.events.length > 0) {
    console.log(`  Events                  : ${context.events.map((e) => e.type).join(", ")}`);
  }

  console.log("\n─── AUM & GBTC ───────────────────────────────────");
  console.log(`  Total AUM               : $${(context.totalAumUsd / 1e9).toFixed(2)}B`);
  if (context.gbtcPremiumRate != null) {
    console.log(`  GBTC premium            : ${context.gbtcPremiumRate.toFixed(2)}%`);
  }

  console.log("\n─── Score breakdown ──────────────────────────────");
  console.log(`  Streak score (50%)      : ${streakScore.toFixed(1)}`);
  console.log(`  Sigma score (50%)       : ${sigmaScore.toFixed(1)}`);
  console.log(`  Regime bonus            : ${regimeBonus > 0 ? "+" : ""}${regimeBonus}`);
  console.log(`  ──────────────────────────────`);
  console.log(`  Final score             : ${total.toFixed(1)}  → ${label(total)}`);
  console.log(`  Weight in composite     : 30%`);
  console.log(`  Contribution to index   : ${(total * 0.3).toFixed(2)} pts\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
