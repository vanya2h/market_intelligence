#!/usr/bin/env tsx
/**
 * Validate that all trade_ideas.confluence rows are in the -1..+1 shape.
 *
 * Walks every row, checks per-dim and total are in [-1, +1], bias.strength
 * in [0, 1], and weights sum to ~1.0. Reports out-of-range entries.
 *
 * Use after running the backfill, or any time you want a health snapshot.
 *
 * Usage:
 *   pnpm tsx packages/pipeline/src/scripts/validate-confluence.ts
 */
import "../env.js";
import { prisma } from "../storage/db.js";

interface ConfluenceShape {
  derivatives?: number;
  etfs?: number;
  htf?: number;
  exchangeFlows?: number;
  total?: number;
  bias?: { lean?: string; strength?: number; topFactors?: Array<{ dimension: string; score: number }> };
  weights?: { derivatives?: number; etfs?: number; htf?: number; exchangeFlows?: number };
  sizing?: { positionSizePct?: number; convictionMultiplier?: number; dailyVolPct?: number };
}

async function main(): Promise<void> {
  const ideas = await prisma.tradeIdea.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, confluence: true },
  });

  let totalRows = 0;
  let withConf = 0;
  let withBias = 0;
  let withWeights = 0;
  let withSizing = 0;

  // Range tracking
  const dimMin: Record<string, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };
  const dimMax: Record<string, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };
  let totalMin = 0;
  let totalMax = 0;
  let strengthMin = 0;
  let strengthMax = 0;
  let weightSumMin = Infinity;
  let weightSumMax = -Infinity;

  // Out-of-range counters (anything outside [-1, +1] for scores or weights)
  const outOfRange: { id: string; field: string; value: number }[] = [];

  for (const idea of ideas) {
    totalRows++;
    if (!idea.confluence) continue;
    withConf++;
    const c = idea.confluence as ConfluenceShape;

    for (const dim of ["derivatives", "etfs", "htf", "exchangeFlows"] as const) {
      const v = c[dim];
      if (typeof v !== "number") continue;
      if (v < (dimMin[dim] ?? 0)) dimMin[dim] = v;
      if (v > (dimMax[dim] ?? 0)) dimMax[dim] = v;
      if (v < -1 || v > 1) outOfRange.push({ id: idea.id, field: dim, value: v });
    }

    if (typeof c.total === "number") {
      if (c.total < totalMin) totalMin = c.total;
      if (c.total > totalMax) totalMax = c.total;
      if (c.total < -1 || c.total > 1) outOfRange.push({ id: idea.id, field: "total", value: c.total });
    }

    if (c.bias) {
      withBias++;
      if (typeof c.bias.strength === "number") {
        const s = c.bias.strength;
        if (s < strengthMin) strengthMin = s;
        if (s > strengthMax) strengthMax = s;
        if (s < 0 || s > 1) outOfRange.push({ id: idea.id, field: "bias.strength", value: s });
      }
      if (Array.isArray(c.bias.topFactors)) {
        for (const f of c.bias.topFactors) {
          if (f.score < 0 || f.score > 1) outOfRange.push({ id: idea.id, field: `bias.topFactors.${f.dimension}`, value: f.score });
        }
      }
    }

    if (c.weights) {
      withWeights++;
      const sum =
        (c.weights.derivatives ?? 0) +
        (c.weights.etfs ?? 0) +
        (c.weights.htf ?? 0) +
        (c.weights.exchangeFlows ?? 0);
      if (sum < weightSumMin) weightSumMin = sum;
      if (sum > weightSumMax) weightSumMax = sum;
      // Sum should be ~1.0 (allow 1% rounding tolerance)
      if (Math.abs(sum - 1) > 0.01) {
        outOfRange.push({ id: idea.id, field: "weights.sum", value: sum });
      }
    }

    if (c.sizing) {
      withSizing++;
    }
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Confluence Sanity Check");
  console.log("═══════════════════════════════════════════════════\n");

  console.log(`Total rows         : ${totalRows}`);
  console.log(`With confluence    : ${withConf}`);
  console.log(`  with bias        : ${withBias}`);
  console.log(`  with weights     : ${withWeights}`);
  console.log(`  with sizing      : ${withSizing}`);

  console.log("\nValue ranges (expected: per-dim & total in [-1, +1])\n");
  for (const dim of ["derivatives", "etfs", "htf", "exchangeFlows"] as const) {
    const lo = dimMin[dim] ?? 0;
    const hi = dimMax[dim] ?? 0;
    console.log(`  ${dim.padEnd(14)} : [${lo.toFixed(3).padStart(7)}, ${hi.toFixed(3).padStart(7)}]`);
  }
  console.log(`  ${"total".padEnd(14)} : [${totalMin.toFixed(3).padStart(7)}, ${totalMax.toFixed(3).padStart(7)}]`);
  console.log(`  ${"bias.strength".padEnd(14)} : [${strengthMin.toFixed(3).padStart(7)}, ${strengthMax.toFixed(3).padStart(7)}]  (expected [0, 1])`);
  if (Number.isFinite(weightSumMin)) {
    console.log(
      `  ${"weights.sum".padEnd(14)} : [${weightSumMin.toFixed(3).padStart(7)}, ${weightSumMax.toFixed(3).padStart(7)}]  (expected ~1.0)`,
    );
  }

  if (outOfRange.length > 0) {
    console.log(`\n⚠ OUT OF RANGE (${outOfRange.length} entries):`);
    for (const o of outOfRange.slice(0, 20)) {
      console.log(`  ${o.id}  ${o.field}=${o.value}`);
    }
    if (outOfRange.length > 20) console.log(`  ... and ${outOfRange.length - 20} more`);
  } else {
    console.log("\n✓ All values within expected ranges.");
  }

  // Show 3 sample rows for visual confirmation
  console.log("\nSample rows (first / median / last):");
  const samples = [ideas[0], ideas[Math.floor(ideas.length / 2)], ideas[ideas.length - 1]].filter(Boolean);
  for (const s of samples) {
    if (!s) continue;
    const c = s.confluence as ConfluenceShape;
    console.log(`\n  ${s.createdAt.toISOString().slice(0, 16)} ${s.id}`);
    console.log(
      `    deriv=${c.derivatives} etfs=${c.etfs} htf=${c.htf} exFlows=${c.exchangeFlows} total=${c.total}`,
    );
    if (c.bias) console.log(`    bias: lean=${c.bias.lean} strength=${c.bias.strength}`);
    if (c.weights) {
      const w = c.weights;
      console.log(
        `    weights: deriv=${w.derivatives} etfs=${w.etfs} htf=${w.htf} exFlows=${w.exchangeFlows}`,
      );
    }
    if (c.sizing) console.log(`    sizing: positionSizePct=${c.sizing.positionSizePct}`);
  }

  console.log();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
