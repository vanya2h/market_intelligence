/**
 * ETF Flows runner — Dimension 03
 *
 * Usage:
 *   pnpm etfs
 *   pnpm etfs --asset ETH
 */

import "../env.js";
import fs from "node:fs";
import path from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import { collect } from "./collector.js";
import { analyze } from "./analyzer.js";
import { runAgent } from "./agent.js";
import type { EtfContext, EtfRegime, EtfState } from "./types.js";

const STATE_FILE = path.resolve("data", "etfs_state.json");

// ─── State persistence ────────────────────────────────────────────────────────

function loadState(asset: string): EtfState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const all = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, EtfState>;
  return all[asset] ?? null;
}

function saveState(state: EtfState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const all = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, EtfState>)
    : {};
  all[state.asset] = state;
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function regimeColor(regime: EtfRegime): ChalkInstance {
  switch (regime) {
    case "STRONG_INFLOW":      return chalk.green.bold;
    case "REVERSAL_TO_INFLOW": return chalk.green;
    case "STRONG_OUTFLOW":     return chalk.red.bold;
    case "REVERSAL_TO_OUTFLOW":return chalk.red;
    case "ETF_NEUTRAL":        return chalk.white;
    case "MIXED":              return chalk.yellow;
  }
}

function flowColor(v: number): ChalkInstance {
  return v > 0 ? chalk.green : v < 0 ? chalk.red : chalk.dim;
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

function printBrief(ctx: EtfContext, interpretation: string, latestDay: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(11));

  console.log(`\n${sep}`);
  console.log(
    `  ${chalk.bold("ETF FLOWS")}  ${chalk.dim(ctx.asset)}  ${chalk.dim(new Date().toUTCString())}`
  );
  console.log(sep);

  const regimeFmt = regimeColor(ctx.regime)(ctx.regime);
  console.log(`\n  ${label("Regime")} ${regimeFmt}`);
  if (ctx.previousRegime) {
    console.log(`  ${label("Previous")} ${chalk.dim(ctx.previousRegime)}`);
  }
  console.log(`  ${label("Since")} ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")} ${chalk.white(ctx.durationDays + "d")}`);

  console.log(`\n  ${chalk.dim("── Flows ────────────────────────────────────────────")}`);

  const f = ctx.flow;
  const sigmaFmt =
    Math.abs(f.todaySigma) >= 2
      ? chalk.yellow.bold(`${f.todaySigma > 0 ? "+" : ""}${f.todaySigma.toFixed(1)}σ`)
      : chalk.dim(`${f.todaySigma > 0 ? "+" : ""}${f.todaySigma.toFixed(1)}σ`);

  console.log(`  ${label("Latest")} ${flowColor(f.today)(formatUsd(f.today))}  ${sigmaFmt}  ${chalk.dim(latestDay)}`);
  console.log(`  ${label("3d Net")} ${flowColor(f.d3Sum)(formatUsd(f.d3Sum))}`);
  console.log(`  ${label("7d Net")} ${flowColor(f.d7Sum)(formatUsd(f.d7Sum))}`);
  console.log(`  ${label("30d Net")} ${flowColor(f.d30Sum)(formatUsd(f.d30Sum))}`);
  console.log(`  ${label("Total AUM")} ${chalk.white.bold(formatUsd(ctx.totalAumUsd).replace(/^[+-]/, "$"))}`);

  if (ctx.gbtcPremiumRate !== undefined) {
    const sign = ctx.gbtcPremiumRate >= 0 ? "+" : "";
    const pFmt =
      ctx.gbtcPremiumRate < -1
        ? chalk.red(`${sign}${ctx.gbtcPremiumRate.toFixed(2)}%`)
        : ctx.gbtcPremiumRate > 1
        ? chalk.green(`${sign}${ctx.gbtcPremiumRate.toFixed(2)}%`)
        : chalk.dim(`${sign}${ctx.gbtcPremiumRate.toFixed(2)}%`);
    console.log(`  ${label("GBTC Prem")} ${pFmt}`);
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const asset = process.argv.includes("--asset")
    ? (process.argv[process.argv.indexOf("--asset") + 1] as "BTC" | "ETH")
    : "BTC";

  step(1, 4, `Collecting ETF data (${asset})...`);
  const snapshot = await collect(asset);
  const latestDay = snapshot.flowHistory
    .filter((d) => d.flowUsd !== 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .at(0)?.date ?? "unknown";
  note(`${snapshot.flowHistory.length} days of flow history · latest: ${latestDay}`);

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
      `today=${context.flow.today >= 0 ? "+" : ""}$${(context.flow.today / 1e6).toFixed(0)}M  ` +
      `streak=${context.flow.consecutiveOutflowDays > 0
        ? `-${context.flow.consecutiveOutflowDays}d`
        : `+${context.flow.consecutiveInflowDays}d`}`
    )
  );
  saveState(nextState);

  step(4, 4, "Running agent...");
  const interpretation = await runAgent(context);

  printBrief(context, interpretation, latestDay);
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
