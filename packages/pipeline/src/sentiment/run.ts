/**
 * Market Sentiment runner — Dimension 06
 *
 * Usage:
 *   pnpm sentiment
 *   pnpm sentiment --asset ETH
 */

import "../env.js";
import fs from "node:fs";
import path from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import { collect } from "./collector.js";
import { analyze } from "./analyzer.js";
import { runAgent } from "./agent.js";
import type { SentimentContext, SentimentRegime, SentimentState } from "./types.js";

const STATE_FILE = path.resolve("data", "sentiment_state.json");

// ─── State persistence ────────────────────────────────────────────────────────

function loadState(asset: string): SentimentState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const all = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, SentimentState>;
  return all[asset] ?? null;
}

function saveState(state: SentimentState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const all = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Record<string, SentimentState>)
    : {};
  all[state.asset] = state;
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function regimeColor(regime: SentimentRegime): ChalkInstance {
  switch (regime) {
    case "EXTREME_FEAR":         return chalk.red.bold;
    case "FEAR":                 return chalk.red;
    case "SENTIMENT_NEUTRAL":    return chalk.white;
    case "GREED":                return chalk.green;
    case "EXTREME_GREED":        return chalk.green.bold;
    case "CONSENSUS_BULLISH":    return chalk.cyan.bold;
    case "CONSENSUS_BEARISH":    return chalk.magenta.bold;
    case "SENTIMENT_DIVERGENCE": return chalk.yellow.bold;
  }
}

// function zScoreColor(z: number): ChalkInstance {
//   if (z >= 0.8) return chalk.green.bold;
//   if (z <= -1.5) return chalk.red.bold;
//   return chalk.dim;
// }

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

function compositeColor(value: number): ChalkInstance {
  if (value < 20) return chalk.red.bold;
  if (value < 40) return chalk.red;
  if (value > 80) return chalk.green.bold;
  if (value > 60) return chalk.green;
  return chalk.yellow;
}

function componentBar(score: number, width: number = 20): string {
  const filled = Math.round((score / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const color = score < 30 ? chalk.red : score > 70 ? chalk.green : chalk.yellow;
  return color(bar);
}

function printBrief(ctx: SentimentContext, interpretation: string): void {
  const sep = chalk.dim("─".repeat(62));
  const label = (s: string) => chalk.dim(s.padEnd(14));
  const m = ctx.metrics;

  console.log(`\n${sep}`);
  console.log(
    `  ${chalk.bold("SENTIMENT")}  ${chalk.dim(ctx.asset)}  ${chalk.dim(new Date().toUTCString())}`
  );
  console.log(sep);

  const regimeFmt = regimeColor(ctx.regime)(ctx.regime);
  console.log(`\n  ${label("Regime")} ${regimeFmt}`);
  if (ctx.previousRegime) {
    console.log(`  ${label("Previous")} ${chalk.dim(ctx.previousRegime)}`);
  }
  console.log(`  ${label("Since")} ${chalk.dim(ctx.since)}`);
  console.log(`  ${label("Duration")} ${chalk.white(ctx.durationDays + "d")}`);

  // ── Composite F&G (our own)
  console.log(`\n  ${chalk.dim("── Composite Fear & Greed ───────────────────────")}`);
  const compFmt = compositeColor(m.compositeIndex);
  console.log(`  ${label("Score")} ${compFmt(m.compositeIndex.toFixed(1))}  ${chalk.dim(m.compositeLabel)}`);

  // ── Component breakdown
  console.log(`\n  ${chalk.dim("── Components ───────────────────────────────────")}`);
  const c = m.components;
  const pad = (s: string) => s.padEnd(16);
  console.log(`  ${chalk.dim(pad("Positioning"))} ${componentBar(c.positioning)} ${chalk.white(c.positioning.toFixed(0).padStart(3))}  ${chalk.dim("(40%)")}`);
  console.log(`  ${chalk.dim(pad("Trend"))} ${componentBar(c.trend)} ${chalk.white(c.trend.toFixed(0).padStart(3))}  ${chalk.dim("(15%)")}`);
  console.log(`  ${chalk.dim(pad("Mom. Diverg."))} ${componentBar(c.momentumDivergence)} ${chalk.white(c.momentumDivergence.toFixed(0).padStart(3))}  ${chalk.dim("(10%)")}`);
  console.log(`  ${chalk.dim(pad("Volatility"))} ${componentBar(c.volatility)} ${chalk.white(c.volatility.toFixed(0).padStart(3))}  ${chalk.dim("(5%)")}`);
  console.log(`  ${chalk.dim(pad("Inst. Flows"))} ${componentBar(c.institutionalFlows)} ${chalk.white(c.institutionalFlows.toFixed(0).padStart(3))}  ${chalk.dim("(30%)")}`);
  // Expert consensus excluded while collecting more data
  // console.log(`  ${chalk.dim(pad("Expert Consns"))} ${componentBar(c.expertConsensus)} ${chalk.white(c.expertConsensus.toFixed(0).padStart(3))}  ${chalk.dim("(25%)")}`);

  // // ── Expert consensus detail
  // console.log(`\n  ${chalk.dim("── Expert Consensus (unbias) ─────────────────────")}`);
  // console.log(`  ${label("Consensus")} ${chalk.white.bold(m.consensusIndex.toFixed(1))}  ${chalk.dim("(-100 to +100)")}`);
  // console.log(`  ${label("30d MA")} ${chalk.dim(m.consensusIndex30dMa.toFixed(1))}`);
  // const deltaFmt = m.consensusDelta7d >= 0
  //   ? chalk.green(`+${m.consensusDelta7d.toFixed(1)}`)
  //   : chalk.red(m.consensusDelta7d.toFixed(1));
  // console.log(`  ${label("7d Delta")} ${deltaFmt}  ${chalk.dim("pts")}`);
  // console.log(`  ${label("Z-Score")} ${zScoreColor(m.zScore)(`${m.zScore >= 0 ? "+" : ""}${m.zScore.toFixed(2)}`)}`);
  // console.log(`  ${label("Bullish")} ${chalk.green(`${Math.round(m.bullishRatio * 100)}%`)} ${chalk.dim(`of ${m.totalAnalysts} analysts`)}`);

  // if (m.divergence) {
  //   console.log(`\n  ${chalk.dim("── Divergence ───────────────────────────────────")}`);
  //   const desc = m.divergenceType === "experts_bullish_crowd_fearful"
  //     ? chalk.yellow.bold("Experts BULLISH ↔ Crowd FEARFUL")
  //     : chalk.yellow.bold("Experts BEARISH ↔ Crowd GREEDY");
  //   console.log(`  ${label("Signal")} ${desc}`);
  // }

  if (ctx.events.length > 0) {
    console.log(`\n  ${chalk.dim("── Events ───────────────────────────────────────")}`);
    for (const e of ctx.events) {
      console.log(`  ${chalk.yellow.bold(`[${e.type}]`)} ${chalk.yellow(e.detail)}`);
    }
  }

  console.log(`\n  ${chalk.dim("── Interpretation ───────────────────────────────")}`);
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

  step(1, 4, `Collecting sentiment + cross-dimension data (${asset})...`);
  const snapshot = await collect(asset);
  // const latestConsensus = snapshot.consensus.at(0);
  const cd = snapshot.crossDimensions;
  // note(
  //   `${snapshot.consensus.length} consensus entries · ` +
  //   `latest: ${latestConsensus?.date ?? "?"}`
  // );
  note(
    `cross-dims: derivatives=${cd.derivatives ? "✓" : "✗"}  ` +
    `etfs=${cd.etfs ? "✓" : "✗"}  ` +
    `htf=${cd.htf ? "✓" : "✗"}`
  );

  step(2, 4, "Loading previous state...");
  const prevState = loadState(asset);
  if (prevState) {
    note(`Previous regime: ${regimeColor(prevState.regime)(prevState.regime)} since ${prevState.since}`);
  } else {
    note("No previous state — first run");
  }

  step(3, 4, "Analyzing regime + computing composite F&G...");
  const { context, nextState } = analyze(snapshot, prevState);
  note(
    `${regimeColor(context.regime)(context.regime)}  ` +
    chalk.dim(`composite=${context.metrics.compositeIndex.toFixed(1)}`)
    // + `  Δ7d=${context.metrics.consensusDelta7d >= 0 ? "+" : ""}${context.metrics.consensusDelta7d.toFixed(1)}`
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
