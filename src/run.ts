/**
 * PoC runner — Dimension 01: Derivatives Structure (BTC)
 *
 * Usage:
 *   npm run analyze
 *
 * Steps:
 *   1. Collect: fetch (mock) snapshot from CoinGlass
 *   2. Store: append to rolling 30-day history, prune old entries
 *   3. Analyze: run deterministic state machine → DerivativesContext
 *   4. Persist: save new regime state
 *   5. Agent: LLM interpretation of the regime (mock)
 *   6. Print brief
 */

import "dotenv/config";
import { collect } from "./derivatives_structure/collector.js";
import { analyze } from "./derivatives_structure/analyzer.js";
import { runAgent } from "./derivatives_structure/agent.js";
import { appendSnapshot, loadState, saveState } from "./storage/json.js";

function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}


function printBrief(
  regime: string,
  since: string,
  durationHours: number,
  previousRegime: string | null,
  ctx: object,
  interpretation: string
): void {
  const sep = "─".repeat(60);

  console.log(`\n${sep}`);
  console.log(`  DERIVATIVES STRUCTURE — BTC`);
  console.log(`  ${new Date().toUTCString()}`);
  console.log(sep);

  const typedCtx = ctx as import("./types.js").DerivativesContext;

  console.log(`\n  Regime:    ${regime}  [OI: ${typedCtx.oiSignal}]`);
  if (previousRegime) {
    console.log(`  Previous:  ${previousRegime}`);
  }
  console.log(`  Since:     ${since}`);
  console.log(`  Duration:  ${durationHours}h`);

  console.log(`\n  ─ Metrics ─`);

  console.log(
    `  Funding:   ${typedCtx.funding.current.toFixed(4)}%  ` +
    `(${typedCtx.funding.percentile["1m"]}th pct / 1 month)`
  );
  console.log(
    `  OI:        ${formatUsd(typedCtx.openInterest.current)}  ` +
    `(${typedCtx.openInterest.percentile["1m"]}th pct / 1 month)`
  );
  console.log(
    `  L/S Ratio: ${typedCtx.longShortRatio.current.toFixed(2)}`
  );
  console.log(
    `  Liq 8h:    ${formatUsd(typedCtx.liquidations.current8h)}  ` +
    `${typedCtx.liquidations.bias}  ` +
    `(${typedCtx.liquidations.percentile["1m"]}th pct / 1 month)`
  );

  if (typedCtx.events.length > 0) {
    console.log(`\n  ─ Events ─`);
    for (const e of typedCtx.events) {
      console.log(`  [${e.type}] ${e.detail}`);
    }
  }

  console.log(`\n  ─ Interpretation ─`);
  // Word-wrap at 58 chars
  const words = interpretation.split(" ");
  let line = "  ";
  for (const word of words) {
    if (line.length + word.length > 60) {
      console.log(line);
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) console.log(line);

  console.log(`\n${sep}\n`);
}

async function main(): Promise<void> {
  console.log("[1/5] Collecting snapshot...");
  const snapshot = await collect();

  console.log("[2/5] Storing to history...");
  const history = appendSnapshot(snapshot);
  console.log(`      History: ${history.length} snapshots`);

  console.log("[3/5] Loading previous state...");
  const prevState = loadState();
  if (prevState) {
    console.log(`      Previous regime: ${prevState.regime} (since ${prevState.since})`);
  } else {
    console.log("      No previous state — first run");
  }

  console.log("[4/5] Analyzing regime...");
  const { context, nextState } = analyze(snapshot, prevState);
  console.log(`      Regime: ${context.regime}  (funding pct1m=${context.funding.percentile["1m"]}, L/S=${context.longShortRatio.current.toFixed(2)})`);
  saveState(nextState);

  console.log("[5/5] Running agent...");
  const interpretation = await runAgent(context);

  printBrief(
    context.regime,
    context.since,
    context.durationHours,
    context.previousRegime,
    context,
    interpretation
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
