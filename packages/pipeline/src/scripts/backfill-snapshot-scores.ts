/**
 * Backfill historical trade ideas with snapshot ML scores.
 *
 * Every TradeIdea has rawFeatures stored in its confluence JSON blob.
 * This script re-runs the snapshot model on those features and updates
 * confluence.total so the trend-strength chart shows a consistent time series.
 *
 * The original per-dimension scores and direction are unchanged — only
 * confluence.total and confluence.aggregator are overwritten.
 *
 * Usage:
 *   tsx src/scripts/backfill-snapshot-scores.ts             # BTC
 *   tsx src/scripts/backfill-snapshot-scores.ts --asset ETH
 *   tsx src/scripts/backfill-snapshot-scores.ts --asset BTC --dry-run
 */

import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../storage/db.js";
import { runSnapshotMl } from "../orchestrator/trade-idea/snapshot-ml.js";
import type { RawFeaturesByDim } from "../orchestrator/trade-idea/extract-features.js";
import { parseAsset } from "./utils.js";
import "../env.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const asset = parseAsset();
  console.log(`\nBackfilling snapshot scores for ${asset}${dryRun ? " [DRY RUN]" : ""}…\n`);

  const rows = await prisma.tradeIdea.findMany({
    where: { asset },
    select: { id: true, createdAt: true, confluence: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let skippedNoFeatures = 0;
  let skippedNoModel = 0;

  for (const row of rows) {
    const conf = row.confluence as Record<string, unknown> | null;
    if (!conf?.rawFeatures) {
      skippedNoFeatures++;
      continue;
    }

    const rawFeatures = conf.rawFeatures as RawFeaturesByDim;
    const result = await runSnapshotMl(asset, rawFeatures);

    if (!result) {
      skippedNoModel++;
      continue;
    }

    const updatedConf = {
      ...conf,
      total: result.score,
      aggregator: {
        source: "ml",
        modelVersion: result.modelVersion,
        stats: result.stats ?? undefined,
      },
    };

    if (!dryRun) {
      await prisma.tradeIdea.update({
        where: { id: row.id },
        data: { confluence: updatedConf as unknown as Prisma.InputJsonValue },
      });
    }

    updated++;
    process.stdout.write(
      `  ${row.createdAt.toISOString().slice(0, 16)}  score=${result.score >= 0 ? "+" : ""}${result.score.toFixed(3)}\n`,
    );
  }

  console.log(`\n  Updated   : ${updated}`);
  console.log(`  No features: ${skippedNoFeatures}`);
  console.log(`  No model   : ${skippedNoModel}`);
  if (dryRun) console.log("\n  Dry run — no DB writes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
