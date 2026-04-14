/**
 * Returns-weighted PnL analysis — evaluates signals using
 * size × return instead of binary win/loss.
 *
 * Simulates both old sizing (0.25 + 1.75×conv^1.5, min 5%)
 * and new sizing (2.0×conv^1.5, no floor) to compare.
 *
 * Usage:  tsx src/scripts/analyze-pnl.ts
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import chalk from "chalk";

interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
}

const DIMS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
function section(t: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${chalk.bold(t)}`);
  console.log(`${"═".repeat(70)}`);
}

// Sizing functions
function oldMultiplier(conviction: number): number {
  return 0.25 + 1.75 * Math.pow(Math.max(conviction, 0), 1.5);
}
function newMultiplier(conviction: number): number {
  return 2.0 * Math.pow(Math.max(conviction, 0), 1.5);
}

async function main() {
  const rawIdeas = await prisma.tradeIdea.findMany({
    include: { returns: { orderBy: { hoursAfter: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  const ideas = rawIdeas
    .filter((i) => i.confluence && i.returns.length > 0)
    .map((i) => {
      const conf = i.confluence as unknown as Confluence;
      const peak = i.returns.reduce((best, r) =>
        Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
      );
      return {
        ...i,
        conf,
        peakQ: peak.qualityAtPoint,
        peakReturn: peak.returnPct,
      };
    });

  console.log(`\n📊 Returns-Weighted PnL Analysis (${ideas.length} ideas)\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // 1. OVERALL: Old vs New sizing
  // ═══════════════════════════════════════════════════════════════════════
  section("1. OVERALL PnL — Old vs New Sizing");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(`${asset} (n=${assetIdeas.length})`)}\n`);

    const oldPnLs = assetIdeas.map((i) => oldMultiplier(i.conf.total) * i.peakReturn);
    const newPnLs = assetIdeas.map((i) => newMultiplier(i.conf.total) * i.peakReturn);

    console.log(`    Old sizing: total PnL=${sum(oldPnLs).toFixed(2)}  avg=${avg(oldPnLs).toFixed(2)}  sharpe≈${(avg(oldPnLs) / std(oldPnLs)).toFixed(2)}`);
    console.log(`    New sizing: total PnL=${sum(newPnLs).toFixed(2)}  avg=${avg(newPnLs).toFixed(2)}  sharpe≈${(avg(newPnLs) / std(newPnLs)).toFixed(2)}`);

    // Breakdown by direction
    for (const dir of ["LONG", "SHORT"] as const) {
      const dirIdeas = assetIdeas.filter((i) => i.direction === dir);
      if (dirIdeas.length === 0) continue;

      const oldDir = dirIdeas.map((i) => oldMultiplier(i.conf.total) * i.peakReturn);
      const newDir = dirIdeas.map((i) => newMultiplier(i.conf.total) * i.peakReturn);

      console.log(`    ${dir.padEnd(6)} old=${sum(oldDir).toFixed(2).padStart(8)}  new=${sum(newDir).toFixed(2).padStart(8)}  n=${dirIdeas.length}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. PnL BY CONVICTION BUCKET
  // ═══════════════════════════════════════════════════════════════════════
  section("2. PnL BY CONVICTION BUCKET");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    const buckets = [
      { min: 0, max: 0.05, label: "0-5%" },
      { min: 0.05, max: 0.15, label: "5-15%" },
      { min: 0.15, max: 0.25, label: "15-25%" },
      { min: 0.25, max: 0.35, label: "25-35%" },
      { min: 0.35, max: 1, label: "35%+" },
    ];

    for (const b of buckets) {
      const inBucket = assetIdeas.filter((i) => i.conf.total >= b.min && i.conf.total < b.max);
      if (inBucket.length === 0) continue;

      const oldPnL = inBucket.map((i) => oldMultiplier(i.conf.total) * i.peakReturn);
      const newPnL = inBucket.map((i) => newMultiplier(i.conf.total) * i.peakReturn);
      const avgReturn = avg(inBucket.map((i) => i.peakReturn));

      console.log(
        `    ${b.label.padEnd(8)} n=${String(inBucket.length).padEnd(4)} ` +
          `avgReturn=${avgReturn.toFixed(2).padStart(6)}%  ` +
          `old PnL=${sum(oldPnL).toFixed(2).padStart(8)}  ` +
          `new PnL=${sum(newPnL).toFixed(2).padStart(8)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. PER-DIMENSION PnL CONTRIBUTION
  // ═══════════════════════════════════════════════════════════════════════
  section("3. PER-DIMENSION PnL — which dims add value when size-weighted?");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    for (const dim of DIMS) {
      // Split by dimension alignment
      const aligned = assetIdeas.filter((i) => i.conf[dim] > 0.1);
      const opposing = assetIdeas.filter((i) => i.conf[dim] < -0.1);
      const neutral = assetIdeas.filter((i) => Math.abs(i.conf[dim]) <= 0.1);

      const aliPnL = aligned.map((i) => newMultiplier(i.conf.total) * i.peakReturn);
      const oppPnL = opposing.map((i) => newMultiplier(i.conf.total) * i.peakReturn);
      const neuPnL = neutral.map((i) => newMultiplier(i.conf.total) * i.peakReturn);

      console.log(
        `    ${dim.padEnd(16)} ` +
          `aligned: ${sum(aliPnL).toFixed(1).padStart(7)} (n=${aligned.length})  ` +
          `neutral: ${sum(neuPnL).toFixed(1).padStart(7)} (n=${neutral.length})  ` +
          `opposing: ${sum(oppPnL).toFixed(1).padStart(7)} (n=${opposing.length})`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. SHORT PnL — does new sizing fix the SHORT problem?
  // ═══════════════════════════════════════════════════════════════════════
  section("4. SHORT PnL — old vs new sizing by conviction");

  for (const asset of ["BTC", "ETH"] as const) {
    const shorts = ideas.filter((i) => i.asset === asset && i.direction === "SHORT");

    console.log(`\n  ${chalk.underline(`${asset} SHORTs (n=${shorts.length})`)}\n`);

    const buckets = [
      { min: 0, max: 0.1, label: "total <10%" },
      { min: 0.1, max: 0.2, label: "total 10-20%" },
      { min: 0.2, max: 0.35, label: "total 20-35%" },
      { min: 0.35, max: 1, label: "total 35%+" },
    ];

    for (const b of buckets) {
      const inBucket = shorts.filter((i) => i.conf.total >= b.min && i.conf.total < b.max);
      if (inBucket.length === 0) continue;

      const oldPnL = inBucket.map((i) => oldMultiplier(i.conf.total) * i.peakReturn);
      const newPnL = inBucket.map((i) => newMultiplier(i.conf.total) * i.peakReturn);

      console.log(
        `    ${b.label.padEnd(14)} n=${String(inBucket.length).padEnd(4)} ` +
          `avgRet=${avg(inBucket.map((i) => i.peakReturn)).toFixed(2).padStart(6)}%  ` +
          `old=${sum(oldPnL).toFixed(2).padStart(8)}  ` +
          `new=${sum(newPnL).toFixed(2).padStart(8)}`,
      );
    }

    const totalOld = sum(shorts.map((i) => oldMultiplier(i.conf.total) * i.peakReturn));
    const totalNew = sum(shorts.map((i) => newMultiplier(i.conf.total) * i.peakReturn));
    console.log(`\n    ${chalk.bold("Total SHORT PnL:")}  old=${totalOld.toFixed(2)}  new=${totalNew.toFixed(2)}  Δ=${(totalNew - totalOld).toFixed(2)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. CUMULATIVE PnL CURVE (time series)
  // ═══════════════════════════════════════════════════════════════════════
  section("5. CUMULATIVE PnL CURVE (weekly)");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    let cumOld = 0, cumNew = 0;
    let weekStart = assetIdeas[0]?.createdAt;
    let weekOld = 0, weekNew = 0, weekCount = 0;

    for (const idea of assetIdeas) {
      const oldPnL = oldMultiplier(idea.conf.total) * idea.peakReturn;
      const newPnL = newMultiplier(idea.conf.total) * idea.peakReturn;

      // New week?
      if (weekStart && idea.createdAt.getTime() - weekStart.getTime() > 7 * 24 * 60 * 60 * 1000) {
        const dateStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        console.log(
          `    ${dateStr.padEnd(8)} n=${String(weekCount).padEnd(3)} ` +
            `old: wk=${weekOld.toFixed(1).padStart(7)} cum=${cumOld.toFixed(1).padStart(8)}  ` +
            `new: wk=${weekNew.toFixed(1).padStart(7)} cum=${cumNew.toFixed(1).padStart(8)}`,
        );
        weekStart = idea.createdAt;
        weekOld = 0;
        weekNew = 0;
        weekCount = 0;
      }

      cumOld += oldPnL;
      cumNew += newPnL;
      weekOld += oldPnL;
      weekNew += newPnL;
      weekCount++;
    }

    // Last partial week
    if (weekCount > 0 && weekStart) {
      const dateStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      console.log(
        `    ${dateStr.padEnd(8)} n=${String(weekCount).padEnd(3)} ` +
          `old: wk=${weekOld.toFixed(1).padStart(7)} cum=${cumOld.toFixed(1).padStart(8)}  ` +
          `new: wk=${weekNew.toFixed(1).padStart(7)} cum=${cumNew.toFixed(1).padStart(8)}`,
      );
    }

    console.log(`\n    ${chalk.bold("Final:")}  old=${cumOld.toFixed(1)}  new=${cumNew.toFixed(1)}  Δ=${(cumNew - cumOld).toFixed(1)}`);
  }

  console.log(`\n${"═".repeat(70)}\n`);
  await prisma.$disconnect();
}

function std(arr: number[]): number {
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((x) => (x - m) ** 2))) || 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
