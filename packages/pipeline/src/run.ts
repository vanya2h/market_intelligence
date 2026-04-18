/**
 * PoC runner — Dimension 01: Derivatives Structure (BTC / ETH)
 *
 * Usage:
 *   npm run analyze
 *   npm run analyze ETH
 */

import chalk, { type ChalkInstance } from "chalk";
import { runAgent } from "./derivatives_structure/agent.js";
import { analyze } from "./derivatives_structure/analyzer.js";
import { collect } from "./derivatives_structure/collector.js";
import { appendSnapshot, loadState, saveState } from "./storage/json.js";
import type { AssetType, DerivativesContext, OiSignal, PositioningState, StressState } from "./types.js";
import "./env.js";

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

function positioningColor(state: PositioningState): ChalkInstance {
  switch (state) {
    case "CROWDED_LONG":
      return chalk.red.bold;
    case "CROWDED_SHORT":
      return chalk.red.bold;
    case "HEATING_UP":
      return chalk.yellow;
    case "POSITIONING_NEUTRAL":
      return chalk.green;
  }
}

function stressColor(state: StressState): ChalkInstance {
  switch (state) {
    case "CAPITULATION":
      return chalk.red.bold;
    case "UNWINDING":
      return chalk.yellow;
    case "DELEVERAGING":
      return chalk.yellow;
    case "STRESS_NONE":
      return chalk.dim;
  }
}

function oiSignalColor(signal: OiSignal): ChalkInstance {
  switch (signal) {
    case "EXTREME":
      return chalk.red.bold;
    case "ELEVATED":
      return chalk.yellow;
    case "OI_NORMAL":
      return chalk.green;
    case "DEPRESSED":
      return chalk.dim;
  }
}

/** Strip markdown and render **bold** inline with chalk */
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

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ─── Brief printer ────────────────────────────────────────────────────────────

function printBrief(ctx: DerivativesContext, interpretation: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(14));

  console.log(`\n${sep}`);
  console.log(
    `  ${chalk.bold("DERIVATIVES STRUCTURE")}  ${chalk.dim(ctx.asset)}  ${chalk.dim(new Date().toUTCString())}`,
  );
  console.log(sep);

  // ── Two dimensions ────────────────────────────────────────────────────────
  const posFmt = positioningColor(ctx.positioning.state)(ctx.positioning.state);
  const strFmt = stressColor(ctx.stress.state)(ctx.stress.state);
  const oiFmt = oiSignalColor(ctx.oiSignal)(`OI:${ctx.oiSignal}`);

  console.log(`\n  ${label("Positioning")} ${posFmt}`);
  if (ctx.positioning.triggers.length > 0)
    console.log(`  ${label("")} ${chalk.dim(ctx.positioning.triggers.join("  ·  "))}`);

  console.log(`  ${label("Stress")}      ${strFmt}  ${chalk.dim("[")}${oiFmt}${chalk.dim("]")}`);
  if (ctx.stress.triggers.length > 0) console.log(`  ${label("")} ${chalk.dim(ctx.stress.triggers.join("  ·  "))}`);

  if (ctx.previousPositioning || ctx.previousStress) {
    const prevPos = ctx.previousPositioning ?? "—";
    const prevStr = ctx.previousStress ?? "—";
    console.log(`  ${label("Previous")}    ${chalk.dim(`${prevPos} | ${prevStr}`)}`);
  }
  console.log(`  ${label("Since")}       ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")}    ${chalk.white(ctx.durationHours + "h")}`);

  // ── Metrics ───────────────────────────────────────────────────────────────
  console.log(`\n  ${chalk.dim("── Metrics ─────────────────────────────────────────")}`);
  const pctLabel = (v: number) => chalk.dim(`(${v}th pct / 1m)`);

  console.log(
    `  ${label("Funding")}     ${chalk.white.bold(ctx.funding.current.toFixed(4) + "%")}  ${pctLabel(ctx.signals.fundingPct1m)}`,
  );
  console.log(
    `  ${label("OI")}          ${chalk.white.bold(formatUsd(ctx.openInterest.current))}  ${pctLabel(ctx.openInterest.percentile["1m"])}  z=${ctx.signals.oiZScore30d.toFixed(2)}`,
  );
  console.log(
    `  ${label("OI change")}   ${chalk.white(pct(ctx.signals.oiChange24h))} 24h  ${chalk.dim("/")}  ${chalk.white(pct(ctx.signals.oiChange7d))} 7d`,
  );
  const cbSign = ctx.coinbasePremium.current >= 0 ? "+" : "";
  console.log(
    `  ${label("CB Premium")}  ${chalk.white.bold(cbSign + ctx.coinbasePremium.current.toFixed(4) + "%")}  ${pctLabel(ctx.coinbasePremium.percentile["1m"])}`,
  );
  console.log(
    `  ${label("Liq 8h")}      ${chalk.white.bold(formatUsd(ctx.liquidations.current8h))}  ${chalk.dim(ctx.liquidations.bias)}  ${pctLabel(ctx.signals.liqPct1m)}  3m=${ctx.signals.liqPct3m}th`,
  );
  if (ctx.signals.priceReturn24h !== null) {
    console.log(
      `  ${label("Price")}       ${chalk.white(pct(ctx.signals.priceReturn24h))} 24h  ${chalk.dim("/")}  ${chalk.white(pct(ctx.signals.priceReturn7d!))} 7d`,
    );
  }
  if (ctx.signals.fundingPressureCycles > 0) {
    console.log(
      `  ${label("Pressure")}    ${chalk.white.bold(ctx.signals.fundingPressureCycles.toString() + " cycles")}  ${chalk.dim(ctx.signals.fundingPressureSide ?? "")}`,
    );
  }

  // ── Events ────────────────────────────────────────────────────────────────
  if (ctx.events.length > 0) {
    console.log(`\n  ${chalk.dim("── Events ───────────────────────────────────────────")}`);
    for (const e of ctx.events) {
      console.log(`  ${chalk.yellow.bold(`[${e.type}]`)} ${chalk.yellow(e.detail)}`);
    }
  }

  // ── Interpretation ────────────────────────────────────────────────────────
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

export async function runDerivatives(asset: AssetType): Promise<void> {
  step(1, 5, `Collecting ${asset} snapshot...`);
  const snapshot = await collect(asset);

  step(2, 5, "Storing to history...");
  const history = await appendSnapshot(asset, snapshot);
  note(`${history.length} snapshots in rolling window`);

  step(3, 5, "Loading previous state...");
  const prevState = await loadState(asset);
  if (prevState) {
    const stressPart = prevState.stress ? stressColor(prevState.stress)(prevState.stress) : chalk.dim("stress:unknown");
    note(
      `Previous: ${positioningColor(prevState.positioning)(prevState.positioning)} | ${stressPart} since ${prevState.since}`,
    );
  } else {
    note("No previous state — first run");
  }

  step(4, 5, "Analyzing regime...");
  const { context, nextState } = analyze(snapshot, prevState);
  note(
    `${positioningColor(context.positioning.state)(context.positioning.state)} | ` +
      `${stressColor(context.stress.state)(context.stress.state)}  ` +
      chalk.dim(`fundingPct1m=${context.signals.fundingPct1m}`),
  );
  saveState(asset, nextState);

  step(5, 5, "Running agent...");
  const interpretation = await runAgent(context);

  printBrief(context, interpretation);
}
