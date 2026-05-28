/**
 * Backfill all trade ideas with correct direction, size, targets, and levels
 * derived from the snapshot model.
 *
 * For each trade idea:
 *   1. Load rawFeatures from the stored confluence JSON
 *   2. Find the closest HtfSnapshot to derive the HTF context
 *   3. Re-run snapshot model → score + direction
 *   4. Re-compute position size (Math.abs(score) as conviction)
 *   5. Re-compute composite target + levels
 *   6. Update direction, positionSizePct, compositeTarget, confluence, levels
 *
 * Usage:
 *   tsx src/scripts/backfill-trade-ideas.ts             # BTC
 *   tsx src/scripts/backfill-trade-ideas.ts --asset ETH
 *   tsx src/scripts/backfill-trade-ideas.ts --asset BTC --dry-run
 */

import "../env.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { HtfContext } from "../htf/types.js";
import type { RawFeaturesByDim } from "../orchestrator/trade-idea/extract-features.js";
import { computeCompositeTarget } from "../orchestrator/trade-idea/composite-target.js";
import { computePositionSize } from "../orchestrator/trade-idea/sizing.js";
import { runSnapshotMl } from "../orchestrator/trade-idea/snapshot-ml.js";
import { prisma } from "../storage/db.js";
import { parseAsset } from "./utils.js";

const dryRun = process.argv.includes("--dry-run");

// ─── Binary search: latest HTF snapshot at or before a given timestamp ────────

type HtfRow = { id: string; timestamp: Date; context: unknown; snapshotPrice: number | null };

function latestBefore(sorted: HtfRow[], ts: number): HtfRow | null {
  let lo = 0, hi = sorted.length - 1, result: HtfRow | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.timestamp.getTime() <= ts) { result = sorted[mid]!; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}

function hasFullContext(ctx: unknown): ctx is HtfContext {
  const c = ctx as Record<string, unknown>;
  if (c.atr == null || c.volatility == null || c.sweep == null) return false;
  const vp = c.volumeProfile as Record<string, unknown> | null | undefined;
  return vp?.near != null && vp?.structural != null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  console.log(`\nBackfilling trade ideas for ${asset}${dryRun ? " [DRY RUN]" : ""}…\n`);

  const [tradeIdeas, htfSnapshots] = await Promise.all([
    prisma.tradeIdea.findMany({
      where: { asset },
      include: { levels: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.htfSnapshot.findMany({
      where: { asset },
      select: { id: true, timestamp: true, context: true, snapshotPrice: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  console.log(`  Trade ideas : ${tradeIdeas.length}`);
  console.log(`  HTF snaps   : ${htfSnapshots.length}\n`);

  let updated = 0;
  let skippedNoFeatures = 0;
  let skippedNoHtf = 0;
  let skippedNoModel = 0;
  let skippedOldContext = 0;

  for (const idea of tradeIdeas) {
    const conf = idea.confluence as Record<string, unknown> | null;
    if (!conf?.rawFeatures) { skippedNoFeatures++; continue; }

    const rawFeatures = conf.rawFeatures as RawFeaturesByDim;
    const htfRow = latestBefore(htfSnapshots, idea.createdAt.getTime());
    if (!htfRow) { skippedNoHtf++; continue; }

    if (!hasFullContext(htfRow.context)) { skippedOldContext++; continue; }

    const htfContext = htfRow.context;
    const result = await runSnapshotMl(asset, rawFeatures);
    if (!result) { skippedNoModel++; continue; }

    const score = result.score;
    const direction = score >= 0 ? "LONG" : "SHORT";
    const sizing = computePositionSize(Math.abs(score), htfContext);
    const { entryPrice, compositeTarget, levels } = computeCompositeTarget(htfContext, direction, Math.abs(score));

    const updatedConf: Record<string, unknown> = {
      ...conf,
      total: score,
      aggregator: {
        source: "ml",
        modelVersion: result.modelVersion,
        stats: result.stats ?? undefined,
      },
      sizing: {
        positionSizePct: sizing.positionSizePct,
        convictionMultiplier: sizing.convictionMultiplier,
        dailyVolPct: sizing.dailyVolPct,
      },
    };

    if (!dryRun) {
      await prisma.$transaction([
        prisma.tradeIdea.update({
          where: { id: idea.id },
          data: {
            direction,
            entryPrice,
            compositeTarget,
            positionSizePct: sizing.positionSizePct,
            confluence: updatedConf as unknown as Prisma.InputJsonValue,
          },
        }),
        prisma.tradeIdeaLevel.deleteMany({ where: { tradeIdeaId: idea.id } }),
        prisma.tradeIdeaLevel.createMany({
          data: levels.map((l) => ({ tradeIdeaId: idea.id, type: l.type, label: l.label, price: l.price })),
        }),
      ]);
    }

    updated++;
    const prevDir = idea.direction;
    const flip = prevDir !== direction ? ` [${prevDir}→${direction}]` : "";
    process.stdout.write(
      `  ${idea.createdAt.toISOString().slice(0, 16)}  ${direction}  score=${score >= 0 ? "+" : ""}${score.toFixed(3)}  size=${sizing.positionSizePct}%  target=${compositeTarget.toFixed(0)}${flip}\n`,
    );
  }

  console.log(`\n  Updated          : ${updated}`);
  console.log(`  No rawFeatures   : ${skippedNoFeatures}`);
  console.log(`  No HTF snapshot  : ${skippedNoHtf}`);
  console.log(`  Old HTF context  : ${skippedOldContext}`);
  console.log(`  No model         : ${skippedNoModel}`);
  if (dryRun) console.log("\n  Dry run — no DB writes.");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
