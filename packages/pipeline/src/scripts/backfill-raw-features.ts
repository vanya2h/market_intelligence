/**
 * Backfill rawFeatures into existing TradeIdea rows.
 *
 * For each TradeIdea whose confluence JSON is missing the rawFeatures key,
 * loads the per-dimension context from the linked Brief's dimension rows,
 * re-runs amplitude encoding, and patches the confluence JSON in place.
 *
 * Safe to run multiple times — rows already containing rawFeatures are skipped.
 *
 * Usage:
 *   pnpm ml:backfill-features              # patch all missing rows
 *   pnpm ml:backfill-features --dry-run    # print what would change, no writes
 */

import chalk from "chalk";
import type { EtfContext } from "../etfs/types.js";
import type { ExchangeFlowsContext } from "../exchange_flows/types.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { HtfContext } from "../htf/types.js";
import { extractRawFeatures } from "../orchestrator/trade-idea/extract-features.js";
import type {
  DerivativesOutput,
  DimensionOutput,
  EtfsOutput,
  ExchangeFlowsOutput,
  HtfOutput,
} from "../orchestrator/types.js";
import { prisma } from "../storage/db.js";
import type { DerivativesContext } from "../types.js";
import "../env.js";

const DRY_RUN = process.argv.includes("--dry-run");
// --force re-computes rawFeatures even on rows that already have them.
// Use after adding new features to extract-features.ts so existing rows get updated.
const FORCE = process.argv.includes("--force");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function needsBackfill(confluence: unknown): boolean {
  if (confluence == null || typeof confluence !== "object") return false;
  if (FORCE) return true;
  return !("rawFeatures" in (confluence as object));
}

/**
 * Build a minimal DimensionOutput[] from stored context JSONs.
 * extractRawFeatures only reads `dimension` and `context` from each entry,
 * so we only need those two fields to be correct.
 */
function buildOutputs(contexts: {
  derivatives: { context: unknown; since: Date } | null;
  etfs: { context: unknown; since: Date } | null;
  htf: { context: unknown; since: Date } | null;
  exchangeFlows: { context: unknown; since: Date } | null;
}): DimensionOutput[] {
  const out: DimensionOutput[] = [];
  if (contexts.derivatives?.context) {
    out.push({
      dimension: "DERIVATIVES",
      since: contexts.derivatives.since.toISOString(),
      context: contexts.derivatives.context as DerivativesContext,
    } as unknown as DerivativesOutput);
  }
  if (contexts.etfs?.context) {
    out.push({
      dimension: "ETFS",
      since: contexts.etfs.since.toISOString(),
      context: contexts.etfs.context as EtfContext,
    } as unknown as EtfsOutput);
  }
  if (contexts.htf?.context) {
    out.push({
      dimension: "HTF",
      since: contexts.htf.since.toISOString(),
      context: contexts.htf.context as HtfContext,
    } as unknown as HtfOutput);
  }
  if (contexts.exchangeFlows?.context) {
    out.push({
      dimension: "EXCHANGE_FLOWS",
      since: contexts.exchangeFlows.since.toISOString(),
      context: contexts.exchangeFlows.context as ExchangeFlowsContext,
    } as unknown as ExchangeFlowsOutput);
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.bold.cyan("\n  Backfill rawFeatures into TradeIdea rows\n"));
  if (DRY_RUN) console.log(chalk.yellow("  DRY RUN — no writes will be made\n"));

  // Load all trade ideas with their per-dim contexts in one query.
  const trades = await prisma.tradeIdea.findMany({
    select: {
      id: true,
      asset: true,
      createdAt: true,
      confluence: true,
      brief: {
        select: {
          derivatives: { select: { context: true, since: true } },
          etfs: { select: { context: true, since: true } },
          htf: { select: { context: true, since: true } },
          exchangeFlows: { select: { context: true, since: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const toBackfill = trades.filter((t) => needsBackfill(t.confluence));

  console.log(`  Total trade ideas:    ${trades.length}`);
  console.log(`  Already have rawFeatures: ${trades.length - toBackfill.length}`);
  console.log(`  To backfill:          ${chalk.bold(String(toBackfill.length))}\n`);

  if (toBackfill.length === 0) {
    console.log(chalk.green("  Nothing to do."));
    return;
  }

  let patched = 0;
  let skipped = 0;
  let errors = 0;

  for (const trade of toBackfill) {
    const label = `${trade.asset} ${trade.id.slice(-8)} ${trade.createdAt.toISOString().slice(0, 10)}`;

    try {
      if (!trade.brief) {
        console.log(chalk.dim(`  skip  ${label} — no linked brief`));
        skipped++;
        continue;
      }

      const outputs = buildOutputs(trade.brief);
      if (outputs.length === 0) {
        console.log(chalk.dim(`  skip  ${label} — no dimension contexts found`));
        skipped++;
        continue;
      }

      const rawFeatures = extractRawFeatures(outputs, trade.createdAt);
      const dimsPresent = outputs.map((o) => o.dimension).join(", ");

      if (DRY_RUN) {
        const featureCount = Object.values(rawFeatures).reduce((n, f) => n + Object.keys(f).length, 0);
        console.log(chalk.cyan(`  would patch  ${label}`) + chalk.dim(`  [${dimsPresent}]  ${featureCount} features`));
        patched++;
        continue;
      }

      // Merge rawFeatures into existing confluence JSON.
      const currentConfluence = (trade.confluence ?? {}) as Record<string, unknown>;
      await prisma.tradeIdea.update({
        where: { id: trade.id },
        data: {
          confluence: { ...currentConfluence, rawFeatures } as unknown as Prisma.InputJsonValue,
        },
      });

      console.log(chalk.green(`  patched  ${label}`) + chalk.dim(`  [${dimsPresent}]`));
      patched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`  error    ${label} — ${msg}`));
      errors++;
    }
  }

  console.log("");
  console.log(
    DRY_RUN
      ? chalk.cyan(`  Would patch ${patched} rows, skip ${skipped}.`)
      : chalk.bold(
          `  Done. Patched=${chalk.green(String(patched))}  Skipped=${skipped}  Errors=${chalk.red(String(errors))}`,
        ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    prisma.$disconnect().finally(() => process.exit(1));
  });
