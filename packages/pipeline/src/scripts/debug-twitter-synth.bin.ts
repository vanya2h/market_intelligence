#!/usr/bin/env tsx
/**
 * Debug script — Twitter Synthesizer
 *
 * Loads the most recent brief for an asset, replays delta computation,
 * and shows what the twitter synthesizer would produce (or skip).
 *
 * Usage:
 *   pnpm tsx src/orchestrator/debug-twitter-synth.bin.ts
 *   pnpm tsx src/orchestrator/debug-twitter-synth.bin.ts --asset ETH
 *   pnpm tsx src/orchestrator/debug-twitter-synth.bin.ts --id <briefId>
 *   pnpm tsx src/orchestrator/debug-twitter-synth.bin.ts --id <briefId> --prev <prevId>
 *   pnpm tsx src/orchestrator/debug-twitter-synth.bin.ts --prompt   # also print raw LLM prompt
 */

import "../env.js";
import chalk from "chalk";
import { prisma } from "../storage/db.js";
import { computeDelta } from "../orchestrator/delta.js";
import { synthesizeTweet, buildPrompt } from "../orchestrator/twitter-synthesizer.js";
import type { DimensionOutput } from "../orchestrator/types.js";
import { parseAsset } from "./utils.js";

const asset = parseAsset();

const briefId = process.argv.includes("--id")
  ? process.argv[process.argv.indexOf("--id") + 1]
  : undefined;

const prevId = process.argv.includes("--prev")
  ? process.argv[process.argv.indexOf("--prev") + 1]
  : undefined;

const showPrompt = process.argv.includes("--prompt");

async function main(): Promise<void> {
  console.log(chalk.bold(`\nTwitter synth debug for ${asset}\n`));

  const briefInclude = {
    derivatives: true,
    etfs: true,
    htf: true,
    sentiment: true,
    exchangeFlows: true,
  } as const;

  const latest = briefId
    ? await prisma.brief.findUnique({ where: { id: briefId }, include: briefInclude })
    : await prisma.brief.findFirst({ where: { asset }, orderBy: { timestamp: "desc" }, include: briefInclude });

  if (!latest) {
    console.log(chalk.red("No briefs found for this asset. Run `pnpm brief` first."));
    process.exit(1);
  }

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

  // ── Delta ──

  const delta = await computeDelta(asset, outputs, prevId ? { previousBriefId: prevId } : {});

  const tierColor = delta.tier === "high" ? chalk.red : delta.tier === "medium" ? chalk.yellow : chalk.green;
  console.log(`${chalk.bold("Delta tier:")} ${tierColor.bold(delta.tier.toUpperCase())}  ${chalk.dim(`(maxZ=${delta.maxZ === Infinity ? "∞" : delta.maxZ.toFixed(3)})`)}`);
  console.log(`${chalk.bold("Change summary:")} ${chalk.dim(delta.changeSummary)}`);
  console.log();

  // ── Decision ──

  const sep = "─".repeat(60);

  if (delta.tier === "low") {
    console.log(chalk.yellow.bold("→ SKIPPED") + chalk.dim(" (low delta — nothing new worth tweeting)"));
    await prisma.$disconnect();
    return;
  }

  if (showPrompt) {
    console.log(chalk.bold("Raw LLM prompt:"));
    console.log(sep);
    console.log(buildPrompt(asset, outputs, delta));
    console.log(sep);
    console.log();
  }

  console.log(chalk.bold(`Calling synthesizeTweet (${delta.tier} delta)...`));
  const tweet = await synthesizeTweet(asset, outputs, undefined, delta);

  console.log();
  console.log(chalk.bold.cyan("TWEET OUTPUT"));
  console.log(sep);
  if (tweet) {
    console.log(tweet);
    console.log(sep);
    console.log(chalk.dim(`${tweet.length} / 280 chars`));
  } else {
    console.log(chalk.yellow("(null — skipped by synthesizer)"));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(chalk.red.bold("Error:"), err);
  process.exit(1);
});
