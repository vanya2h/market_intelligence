/**
 * PoC runner — Dimension 01: Derivatives Structure (BTC)
 *
 * Usage:
 *   npm run analyze
 */

import "dotenv/config";
import chalk, { type ChalkInstance } from "chalk";
import { collect } from "./derivatives_structure/collector.js";
import { analyze } from "./derivatives_structure/analyzer.js";
import { runAgent } from "./derivatives_structure/agent.js";
import { appendSnapshot, loadState, saveState } from "./storage/json.js";
import type { DerivativesContext, DerivativesRegime, OiSignal } from "./types.js";

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

function regimeColor(regime: DerivativesRegime): ChalkInstance {
  switch (regime) {
    case "CROWDED_LONG":
    case "CAPITULATION":   return chalk.red.bold;
    case "CROWDED_SHORT":  return chalk.red.bold;
    case "SHORT_SQUEEZE":  return chalk.magenta.bold;
    case "HEATING_UP":     return chalk.yellow;
    case "UNWINDING":
    case "DELEVERAGING":   return chalk.yellow;
    case "NEUTRAL":        return chalk.green;
  }
}

function oiSignalColor(signal: OiSignal): ChalkInstance {
  switch (signal) {
    case "EXTREME":   return chalk.red.bold;
    case "ELEVATED":  return chalk.yellow;
    case "NORMAL":    return chalk.green;
    case "DEPRESSED": return chalk.dim;
  }
}

/** Strip markdown from Claude's output and render **bold** inline with chalk */
function renderMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")               // remove ## headings
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))  // **bold**
    .replace(/\*(.+?)\*/g, "$1")                // *italic* → plain
    .trim();
}

function step(n: number, total: number, label: string): void {
  console.log(`\n${chalk.cyan.bold(`[${n}/${total}]`)} ${chalk.white(label)}`);
}

function note(text: string): void {
  console.log(`      ${chalk.dim(text)}`);
}

// ─── Brief printer ────────────────────────────────────────────────────────────

function printBrief(ctx: DerivativesContext, interpretation: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(11));

  console.log(`\n${sep}`);
  console.log(`  ${chalk.bold("DERIVATIVES STRUCTURE")}  ${chalk.dim("BTC")}  ${chalk.dim(new Date().toUTCString())}`);
  console.log(sep);

  // Regime + OI signal
  const regimeFmt = regimeColor(ctx.regime)(ctx.regime);
  const oiFmt = oiSignalColor(ctx.oiSignal)(`OI:${ctx.oiSignal}`);
  console.log(`\n  ${label("Regime")} ${regimeFmt}  ${chalk.dim("[")}${oiFmt}${chalk.dim("]")}`);
  if (ctx.previousRegime) {
    console.log(`  ${label("Previous")} ${chalk.dim(ctx.previousRegime)}`);
  }
  console.log(`  ${label("Since")} ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")} ${chalk.white(ctx.durationHours + "h")}`);

  // Metrics
  console.log(`\n  ${chalk.dim("── Metrics ─────────────────────────────────────────")}`);

  const pct = (v: number) => chalk.dim(`(${v}th pct / 1 month)`);

  console.log(
    `  ${label("Funding")} ${chalk.white.bold(ctx.funding.current.toFixed(4) + "%")}  ${pct(ctx.funding.percentile["1m"])}`
  );
  console.log(
    `  ${label("OI")} ${chalk.white.bold(formatUsd(ctx.openInterest.current))}  ${pct(ctx.openInterest.percentile["1m"])}`
  );
  console.log(
    `  ${label("L/S Ratio")} ${chalk.white.bold(ctx.longShortRatio.current.toFixed(2))}`
  );
  const cbSign = ctx.coinbasePremium.current >= 0 ? "+" : "";
  console.log(
    `  ${label("CB Premium")} ${chalk.white.bold(cbSign + ctx.coinbasePremium.current.toFixed(4) + "%")}  ${pct(ctx.coinbasePremium.percentile["1m"])}`
  );
  console.log(
    `  ${label("Liq 8h")} ${chalk.white.bold(formatUsd(ctx.liquidations.current8h))}  ${chalk.dim(ctx.liquidations.bias)}  ${pct(ctx.liquidations.percentile["1m"])}`
  );

  // Events
  if (ctx.events.length > 0) {
    console.log(`\n  ${chalk.dim("── Events ───────────────────────────────────────────")}`);
    for (const e of ctx.events) {
      console.log(`  ${chalk.yellow.bold(`[${e.type}]`)} ${chalk.yellow(e.detail)}`);
    }
  }

  // Interpretation
  console.log(`\n  ${chalk.dim("── Interpretation ───────────────────────────────────")}`);
  const rendered = renderMarkdown(interpretation);
  // Word-wrap at 60 chars
  const words = rendered.split(" ");
  let line = "  ";
  for (const word of words) {
    // chalk sequences add invisible chars — measure visible length roughly
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
  step(1, 5, "Collecting snapshot...");
  const snapshot = await collect();

  step(2, 5, "Storing to history...");
  const history = await appendSnapshot(snapshot);
  note(`${history.length} snapshots in rolling window`);

  step(3, 5, "Loading previous state...");
  const prevState = await loadState();
  if (prevState) {
    note(`Previous regime: ${regimeColor(prevState.regime)(prevState.regime)} since ${prevState.since}`);
  } else {
    note("No previous state — first run");
  }

  step(4, 5, "Analyzing regime...");
  const { context, nextState } = analyze(snapshot, prevState);
  note(
    `${regimeColor(context.regime)(context.regime)}  ` +
    chalk.dim(`funding pct1m=${context.funding.percentile["1m"]}  L/S=${context.longShortRatio.current.toFixed(2)}`)
  );
  saveState(nextState);

  step(5, 5, "Running agent...");
  const interpretation = await runAgent(context);

  printBrief(context, interpretation);
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
