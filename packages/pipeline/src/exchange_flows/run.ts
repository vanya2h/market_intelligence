/**
 * Exchange Flows runner — Dimension 04
 *
 * Usage:
 *   pnpm exchange-flows
 *   pnpm exchange-flows --asset ETH
 */

import fs from "node:fs";
import path from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import type { AssetType } from "../types.js";
import { runAgent } from "./agent.js";
import { analyze } from "./analyzer.js";
import { collect } from "./collector.js";
import type { ExchangeFlowsContext, ExchangeFlowsRegime, ExchangeFlowsState } from "./types.js";
import "../env.js";

const STATE_FILE = path.resolve("data", "exchange_flows_state.json");

// ─── State persistence ────────────────────────────────────────────────────────

function loadState(asset: string): ExchangeFlowsState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const all = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, ExchangeFlowsState>;
  return all[asset] ?? null;
}

function saveState(state: ExchangeFlowsState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const all = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, ExchangeFlowsState>)
    : {};
  all[state.asset] = state;
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatAsset(v: number, asset: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M ${asset}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${asset}`;
  return `${sign}${abs.toFixed(2)} ${asset}`;
}

function formatUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function regimeColor(regime: ExchangeFlowsRegime): ChalkInstance {
  switch (regime) {
    case "ACCUMULATION":
      return chalk.green.bold;
    case "HEAVY_OUTFLOW":
      return chalk.green;
    case "DISTRIBUTION":
      return chalk.red.bold;
    case "HEAVY_INFLOW":
      return chalk.red;
    case "EF_NEUTRAL":
      return chalk.white;
    default:
      return chalk.white;
  }
}

function flowColor(v: number): ChalkInstance {
  // For exchange flows: outflow (negative) = bullish (green), inflow (positive) = bearish (red)
  return v < 0 ? chalk.green : v > 0 ? chalk.red : chalk.dim;
}

/** Strip markdown and render **bold** with chalk */
function renderMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/\*(.+?)\*/g, "$1")
    .trim();
}

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

// ─── Brief printer ────────────────────────────────────────────────────────────

function printBrief(ctx: ExchangeFlowsContext, interpretation: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(14));

  console.log(`\n${sep}`);
  console.log(`  ${chalk.bold("EXCHANGE FLOWS")}  ${chalk.dim(ctx.asset)}  ${chalk.dim(new Date().toUTCString())}`);
  console.log(sep);

  const regimeFmt = regimeColor(ctx.regime)(ctx.regime);
  console.log(`\n  ${label("Regime")} ${regimeFmt}`);
  if (ctx.previousRegime) {
    console.log(`  ${label("Previous")} ${chalk.dim(ctx.previousRegime)}`);
  }
  console.log(`  ${label("Since")} ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")} ${chalk.white(ctx.durationDays + "d")}`);

  console.log(`\n  ${chalk.dim("── Flows ────────────────────────────────────────────")}`);

  const m = ctx.metrics;
  const sigmaFmt =
    Math.abs(m.todaySigma) >= 2
      ? chalk.yellow.bold(`${m.todaySigma > 0 ? "+" : ""}${m.todaySigma.toFixed(1)}σ`)
      : chalk.dim(`${m.todaySigma > 0 ? "+" : ""}${m.todaySigma.toFixed(1)}σ`);

  console.log(`  ${label("1d Net Flow")} ${flowColor(m.netFlow1d)(formatAsset(m.netFlow1d, ctx.asset))}  ${sigmaFmt}`);
  console.log(
    `  ${label("7d Net Flow")} ${flowColor(m.netFlow7d)(formatAsset(m.netFlow7d, ctx.asset))}  ${chalk.dim(`(${m.reserveChange7dPct > 0 ? "+" : ""}${m.reserveChange7dPct.toFixed(2)}%)`)}`,
  );
  console.log(
    `  ${label("30d Net Flow")} ${flowColor(m.netFlow30d)(formatAsset(m.netFlow30d, ctx.asset))}  ${chalk.dim(`(${m.reserveChange30dPct > 0 ? "+" : ""}${m.reserveChange30dPct.toFixed(2)}%)`)}`,
  );
  console.log(
    `  ${label("Total Reserve")} ${chalk.white.bold(formatAsset(m.totalBalance, ctx.asset).replace(/^[+-]/, ""))}  ${chalk.dim(`(${formatUsd(m.totalBalanceUsd).replace(/^[+-]/, "")})`)}`,
  );
  console.log(`  ${label("Trend")} ${chalk.white(m.balanceTrend)}`);

  if (m.topExchanges.length > 0) {
    console.log(`\n  ${chalk.dim("── Top Exchanges ────────────────────────────────────")}`);
    for (const ex of m.topExchanges) {
      const changeFmt =
        ex.changePct7d !== 0 ? chalk.dim(`  7d: ${ex.changePct7d > 0 ? "+" : ""}${ex.changePct7d.toFixed(1)}%`) : "";
      console.log(
        `  ${chalk.dim(ex.exchange.padEnd(14))} ${chalk.white(formatAsset(ex.balance, ctx.asset).replace(/^[+-]/, ""))}${changeFmt}`,
      );
    }
  }

  if (ctx.events.length > 0) {
    console.log(`\n  ${chalk.dim("── Events ───────────────────────────────────────────")}`);
    for (const e of ctx.events) {
      console.log(`  ${chalk.yellow.bold(`[${e.type}]`)} ${chalk.yellow(e.detail)}`);
    }
  }

  console.log(`\n  ${chalk.dim("── Interpretation ───────────────────────────────────")}`);
  const rendered = renderMarkdown(interpretation);
  const words = rendered.split(" ");
  let line = "  ";
  for (const word of words) {
    const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    if (visibleLen + word.replace(/\x1b\[[0-9;]*m/g, "").length > 62) {
      console.log(line);
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) console.log(line);

  console.log(`\n${sep}\n`);
}

// ─── Main (reusable) ──────────────────────────────────────────────────────────

export async function runExchangeFlows(asset: AssetType): Promise<void> {
  step(1, 4, `Collecting exchange flow data (${asset})...`);
  const snapshot = await collect(asset);
  note(`${snapshot.balanceHistory.length} balance data points · ${snapshot.currentBalances.length} exchanges`);

  step(2, 4, "Loading previous state...");
  const prevState = loadState(asset);
  if (prevState) {
    note(`Previous regime: ${regimeColor(prevState.regime)(prevState.regime)} since ${prevState.since}`);
  } else {
    note("No previous state — first run");
  }

  step(3, 4, "Analyzing regime...");
  const { context, nextState } = analyze(snapshot, prevState);
  note(
    `${regimeColor(context.regime)(context.regime)}  ` +
      chalk.dim(
        `7d=${context.metrics.netFlow7d >= 0 ? "+" : ""}${context.metrics.netFlow7d.toFixed(0)} ${asset}  ` +
          `trend=${context.metrics.balanceTrend}`,
      ),
  );
  saveState(nextState);

  step(4, 4, "Running agent...");
  const interpretation = await runAgent(context);

  printBrief(context, interpretation);
}
