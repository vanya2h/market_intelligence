/**
 * Debug script — Delta Analysis
 *
 * Loads the two most recent briefs for an asset from DB, replays the delta
 * computation, and prints the full DeltaSummary with per-metric z-scores.
 *
 * Usage:
 *   pnpm tsx src/orchestrator/debug-delta.bin.ts
 *   pnpm tsx src/orchestrator/debug-delta.bin.ts --asset ETH
 */

import chalk from "chalk";
import { computeDelta } from "../orchestrator/delta.js";
import type { DimensionOutput } from "../orchestrator/types.js";
import { prisma } from "../storage/db.js";
import { parseAsset } from "./utils.js";
import "../env.js";

const asset = parseAsset();

const briefId = process.argv.includes("--id") ? process.argv[process.argv.indexOf("--id") + 1] : undefined;

const prevId = process.argv.includes("--prev") ? process.argv[process.argv.indexOf("--prev") + 1] : undefined;

async function main(): Promise<void> {
  console.log(chalk.bold(`\nDelta debug for ${asset}\n`));

  const briefInclude = {
    derivatives: true,
    etfs: true,
    htf: true,
    sentiment: true,
    exchangeFlows: true,
  } as const;

  // Load a specific brief or the most recent one
  const latest = briefId
    ? await prisma.brief.findUnique({ where: { id: briefId }, include: briefInclude })
    : await prisma.brief.findFirst({ where: { asset }, orderBy: { timestamp: "desc" }, include: briefInclude });

  if (!latest) {
    console.log(chalk.red("No briefs found for this asset. Run `pnpm brief` first."));
    process.exit(1);
  }

  // Load previous brief for side-by-side comparison
  const previous = prevId
    ? await prisma.brief.findUnique({ where: { id: prevId }, select: { id: true, timestamp: true, brief: true } })
    : await prisma.brief.findFirst({
        where: { asset, timestamp: { lt: latest.timestamp } },
        orderBy: { timestamp: "desc" },
        select: { id: true, timestamp: true, brief: true },
      });

  console.log(chalk.dim(`Latest brief:   ${latest.id} @ ${latest.timestamp.toISOString()}`));
  if (previous) {
    console.log(chalk.dim(`Previous brief: ${previous.id} @ ${previous.timestamp.toISOString()}`));
  } else {
    console.log(chalk.dim(`Previous brief: (none — first brief for this asset)`));
  }

  // Reconstruct DimensionOutput[] from the stored brief
  const outputs: DimensionOutput[] = [];

  if (latest.derivatives) {
    outputs.push({
      dimension: "DERIVATIVES",
      regime: latest.derivatives.regime,
      stress: latest.derivatives.stress,
      previousRegime: latest.derivatives.previousRegime,
      previousStress: latest.derivatives.previousStress,
      oiSignal: latest.derivatives.oiSignal ?? "OI_NORMAL",
      since: latest.derivatives.since.toISOString(),
      context: latest.derivatives.context as never,
      interpretation: latest.derivatives.interpretation,
    });
  }

  if (latest.etfs) {
    outputs.push({
      dimension: "ETFS",
      regime: latest.etfs.regime,
      previousRegime: latest.etfs.previousRegime,
      since: latest.etfs.since.toISOString(),
      context: latest.etfs.context as never,
      interpretation: latest.etfs.interpretation,
    });
  }

  if (latest.htf) {
    outputs.push({
      dimension: "HTF",
      regime: latest.htf.regime,
      previousRegime: latest.htf.previousRegime,
      since: latest.htf.since.toISOString(),
      lastStructure: latest.htf.lastStructure,
      snapshotPrice: latest.htf.snapshotPrice,
      context: latest.htf.context as never,
      interpretation: latest.htf.interpretation,
    });
  }

  if (latest.sentiment) {
    outputs.push({
      dimension: "SENTIMENT",
      regime: latest.sentiment.regime,
      previousRegime: latest.sentiment.previousRegime,
      since: latest.sentiment.since.toISOString(),
      compositeIndex: latest.sentiment.compositeIndex,
      compositeLabel: latest.sentiment.compositeLabel,
      positioning: latest.sentiment.positioning,
      trend: latest.sentiment.trend,
      institutionalFlows: latest.sentiment.institutionalFlows,
      exchangeFlows: latest.sentiment.exchangeFlows,
      expertConsensus: latest.sentiment.expertConsensus,
      context: latest.sentiment.context as never,
      interpretation: latest.sentiment.interpretation,
    });
  }

  if (latest.exchangeFlows) {
    outputs.push({
      dimension: "EXCHANGE_FLOWS",
      regime: latest.exchangeFlows.regime,
      previousRegime: latest.exchangeFlows.previousRegime,
      since: latest.exchangeFlows.since.toISOString(),
      context: latest.exchangeFlows.context as never,
      interpretation: latest.exchangeFlows.interpretation,
    });
  }

  console.log(chalk.dim(`Reconstructed ${outputs.length} dimension outputs\n`));

  // ── Previous vs Current brief text ──

  const sep = "─".repeat(60);
  if (previous) {
    console.log(`\n${chalk.bold.yellow("PREVIOUS BRIEF")} ${chalk.dim(`(${previous.timestamp.toISOString()})`)}`);
    console.log(sep);
    console.log(previous.brief);
    console.log(sep);
  }

  console.log(`\n${chalk.bold.cyan("CURRENT BRIEF")} ${chalk.dim(`(${latest.timestamp.toISOString()})`)}`);
  console.log(sep);
  console.log(latest.brief);
  console.log(sep);

  // Run delta computation (compares latest vs second-latest in DB)
  const delta = await computeDelta(asset, outputs, prevId ? { previousBriefId: prevId } : {});

  // ── Delta results ──

  const tierColor = delta.tier === "high" ? chalk.red : delta.tier === "medium" ? chalk.yellow : chalk.green;
  console.log(`${chalk.bold("Tier:")} ${tierColor.bold(delta.tier.toUpperCase())}`);
  console.log(`${chalk.bold("Max Z:")} ${delta.maxZ === Infinity ? "∞" : delta.maxZ.toFixed(3)}`);
  console.log();

  for (const dim of delta.dimensions) {
    const regimeStr = dim.regimeFlipped
      ? chalk.red(`${dim.prevRegime} → ${dim.currRegime}`)
      : chalk.dim(dim.currRegime);
    console.log(`${chalk.cyan.bold(dim.dimension)} — regime: ${regimeStr}`);

    if (dim.topMovers.length === 0) {
      console.log(chalk.dim("  (no previous data to compare)"));
    }

    for (const m of dim.topMovers) {
      const arrow = m.delta > 0 ? chalk.green("↑") : m.delta < 0 ? chalk.red("↓") : chalk.dim("→");
      const zStr = m.zScore === Infinity ? chalk.red.bold("∞") : m.zScore.toFixed(2);
      const sigStr = m.sigma > 0 ? m.sigma.toFixed(4) : chalk.dim("0");
      console.log(
        `  ${arrow} ${m.label.padEnd(35)} ` +
          `${chalk.dim("prev=")}${m.prev.toFixed(4).padStart(12)} ` +
          `${chalk.dim("curr=")}${m.curr.toFixed(4).padStart(12)} ` +
          `${chalk.dim("Δ=")}${m.delta.toFixed(4).padStart(10)} ` +
          `${chalk.dim("σ=")}${String(sigStr).padStart(8)} ` +
          `${chalk.dim("z=")}${zStr}`,
      );
    }
    console.log();
  }

  console.log(chalk.bold("Change summary:"));
  console.log(chalk.dim(delta.changeSummary));
  console.log();
  console.log(chalk.bold("Top tension:"));
  console.log(delta.topTension || chalk.dim("(none)"));
  console.log();

  // Show what the one-liner would look like
  if (delta.tier === "low") {
    const htf = outputs.find((o) => o.dimension === "HTF");
    const priceStr =
      htf && "snapshotPrice" in htf && htf.snapshotPrice
        ? ` at $${htf.snapshotPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
        : "";
    const oneLiner = `${asset}${priceStr} — no dramatic changes since last brief. ${delta.topTension}.`;
    console.log(chalk.bold("One-liner output:"));
    console.log(chalk.yellow(oneLiner));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(chalk.red.bold("Error:"), err);
  process.exit(1);
});
