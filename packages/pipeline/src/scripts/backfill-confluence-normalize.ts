#!/usr/bin/env tsx
/**
 * Backfill — Normalize confluence JSON in trade_ideas to the -1..+1 shape.
 *
 * Reads every TradeIdea row, runs `normalizeConfluenceShape` on its persisted
 * `confluence` JSON, and rewrites the row when the shape changed (legacy →
 * new). Idempotent: re-running is a no-op for already-normalized rows.
 *
 * Usage:
 *   tsx packages/pipeline/src/scripts/backfill-confluence-normalize.ts            # apply (heuristic detection)
 *   tsx packages/pipeline/src/scripts/backfill-confluence-normalize.ts --dry-run  # preview only
 *   tsx packages/pipeline/src/scripts/backfill-confluence-normalize.ts --force    # force-migrate every row
 *
 * Use `--force` for the very first migration on a database that is known to be
 * entirely legacy. Without it, edge-case rows with tiny integer values
 * (e.g. `deriv=0, etfs=1, total=1` from very early runs) are indistinguishable
 * from a hypothetical new-format row with `total=1.0` and would be skipped.
 *
 * Output: a count summary plus per-row diffs (in --dry-run) or update markers
 * (in apply mode).
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import { normalizeConfluenceShape } from "../orchestrator/trade-idea/normalize.js";
import type { Prisma } from "../generated/prisma/client.js";

interface Counts {
  total: number;
  legacy: number;
  alreadyNormalized: number;
  empty: number;
  errors: number;
}

function fmt(n: number): string {
  return n.toString().padStart(5);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const verbose = process.argv.includes("--verbose") || dryRun;

  console.log(
    `\n${dryRun ? "DRY-RUN" : "APPLY"}${force ? " (FORCE)" : ""}: confluence backfill (legacy → -1..+1)\n`,
  );

  const ideas = await prisma.tradeIdea.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, confluence: true },
  });

  const counts: Counts = {
    total: ideas.length,
    legacy: 0,
    alreadyNormalized: 0,
    empty: 0,
    errors: 0,
  };

  for (const idea of ideas) {
    if (idea.confluence === null) {
      counts.empty++;
      continue;
    }

    let result;
    try {
      result = normalizeConfluenceShape(idea.confluence, force);
    } catch (err) {
      counts.errors++;
      console.error(`  [ERROR] ${idea.id}: ${(err as Error).message}`);
      continue;
    }

    if (!result.wasLegacy) {
      counts.alreadyNormalized++;
      continue;
    }

    counts.legacy++;
    const date = idea.createdAt.toISOString().slice(0, 10);

    if (verbose) {
      const old = idea.confluence as Record<string, unknown>;
      const next = result.confluence;
      console.log(
        `  ${date}  ${idea.id}` +
          `\n    BEFORE: deriv=${old.derivatives} etfs=${old.etfs} htf=${old.htf} ` +
          `exFlows=${old.exchangeFlows} total=${old.total}` +
          `\n    AFTER : deriv=${next.derivatives} etfs=${next.etfs} htf=${next.htf} ` +
          `exFlows=${next.exchangeFlows} total=${next.total}`,
      );
    }

    if (!dryRun) {
      await prisma.tradeIdea.update({
        where: { id: idea.id },
        data: {
          confluence: result.confluence as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  console.log("\nSummary");
  console.log(`  total              : ${fmt(counts.total)}`);
  console.log(`  legacy → migrated  : ${fmt(counts.legacy)}${dryRun ? " (would migrate)" : ""}`);
  console.log(`  already normalized : ${fmt(counts.alreadyNormalized)}`);
  console.log(`  empty confluence   : ${fmt(counts.empty)}`);
  if (counts.errors > 0) {
    console.log(`  errors             : ${fmt(counts.errors)}`);
  }
  console.log();

  if (dryRun && counts.legacy > 0) {
    console.log("Re-run without --dry-run to apply.\n");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
