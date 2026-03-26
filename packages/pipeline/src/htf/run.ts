/**
 * HTF Technical Structure runner — Dimension 07
 *
 * Usage:
 *   pnpm htf
 *   pnpm htf --asset ETH
 */

import "../env.js";
import fs from "node:fs";
import path from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import { collect } from "./collector.js";
import { analyze } from "./analyzer.js";
import { runAgent } from "./agent.js";
import type { HtfContext, HtfRegime, HtfState, MarketStructure, MaCrossType } from "./types.js";

const STATE_FILE = path.resolve("data", "htf_state.json");

// ─── State persistence ────────────────────────────────────────────────────────

function loadState(asset: string): HtfState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const all = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, HtfState>;
  return all[asset] ?? null;
}

function saveState(state: HtfState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const all = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, HtfState>)
    : {};
  all[state.asset] = state;
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function regimeColor(regime: HtfRegime): ChalkInstance {
  switch (regime) {
    case "MACRO_BULLISH":
      return chalk.green.bold;
    case "BULL_EXTENDED":
      return chalk.yellow.bold;
    case "MACRO_BEARISH":
      return chalk.red.bold;
    case "BEAR_EXTENDED":
      return chalk.red;
    case "RECLAIMING":
      return chalk.cyan;
    case "RANGING":
      return chalk.white;
    default:
      return chalk.white;
  }
}

function structureColor(s: MarketStructure): ChalkInstance {
  switch (s) {
    case "HH_HL":
      return chalk.green;
    case "LH_LL":
      return chalk.red;
    default:
      return chalk.yellow;
  }
}

function crossColor(c: MaCrossType): ChalkInstance {
  return c === "GOLDEN" ? chalk.green : c === "DEATH" ? chalk.red : chalk.dim;
}

function pctFmt(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? chalk.green : chalk.red;
  return color(`${sign}${pct.toFixed(1)}%`);
}

function rsiColor(v: number): ChalkInstance {
  if (v > 70) return chalk.yellow.bold;
  if (v < 30) return chalk.cyan.bold;
  return chalk.white;
}

function formatPrice(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

function printBrief(ctx: HtfContext, interpretation: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(11));

  console.log(`\n${sep}`);
  console.log(`  ${chalk.bold("HTF STRUCTURE")}  ${chalk.dim(ctx.asset)}  ${chalk.dim(new Date().toUTCString())}`);
  console.log(sep);

  const regimeFmt = regimeColor(ctx.regime)(ctx.regime);
  console.log(`\n  ${label("Regime")} ${regimeFmt}`);
  if (ctx.previousRegime) {
    console.log(`  ${label("Previous")} ${chalk.dim(ctx.previousRegime)}`);
  }
  console.log(`  ${label("Since")} ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")} ${chalk.white(ctx.durationDays + "d")}`);

  console.log(`\n  ${chalk.dim("── Price & MAs ──────────────────────────────────────")}`);
  console.log(`  ${label("Price")}     ${chalk.white.bold(formatPrice(ctx.price))}`);
  console.log(`  ${label("50 DMA")}    ${chalk.white(formatPrice(ctx.ma.sma50))}  ${pctFmt(ctx.ma.priceVsSma50Pct)}`);
  console.log(`  ${label("200 DMA")}   ${chalk.white(formatPrice(ctx.ma.sma200))}  ${pctFmt(ctx.ma.priceVsSma200Pct)}`);

  const crossFmt = crossColor(ctx.ma.crossType)(ctx.ma.crossType);
  const recentCrossFmt =
    ctx.ma.recentCross !== "NONE" ? chalk.yellow.bold(` ← ${ctx.ma.recentCross} CROSS (recent)`) : "";
  console.log(`  ${label("MA Cross")}  ${crossFmt}${recentCrossFmt}`);

  console.log(`\n  ${chalk.dim("── Indicators ───────────────────────────────────────")}`);
  console.log(`  ${label("Daily RSI")} ${rsiColor(ctx.rsi.daily)(ctx.rsi.daily.toFixed(1))}`);
  console.log(`  ${label("4h RSI")}    ${rsiColor(ctx.rsi.h4)(ctx.rsi.h4.toFixed(1))}`);
  console.log(`  ${label("Structure")} ${structureColor(ctx.structure)(ctx.structure.replace("_", "/"))}`);

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

  step(1, 4, `Collecting HTF candles (${asset})...`);
  const snapshot = await collect(asset);

  step(2, 4, "Loading previous state...");
  const prevState = loadState(asset);
  if (prevState) {
    note(`Previous regime: ${regimeColor(prevState.regime)(prevState.regime)} since ${prevState.since}`);
  } else {
    note("No previous state — first run");
  }

  step(3, 4, "Analyzing structure...");
  const { context, nextState } = analyze(snapshot, prevState);
  note(
    `${regimeColor(context.regime)(context.regime)}  ` +
      chalk.dim(
        `structure=${context.structure}  ` +
          `dailyRSI=${context.rsi.daily.toFixed(1)}  4hRSI=${context.rsi.h4.toFixed(1)}  ` +
          `200MA=${context.ma.priceVsSma200Pct > 0 ? "+" : ""}${context.ma.priceVsSma200Pct}%`,
      ),
  );
  saveState(nextState);

  step(4, 4, "Running agent...");
  const interpretation = await runAgent(context);

  printBrief(context, interpretation);
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
