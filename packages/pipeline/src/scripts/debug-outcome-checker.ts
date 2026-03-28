/**
 * Debug script — sanity-checks the outcome checker against real DB data.
 *
 * Prints every trade idea with its levels, returns curve, and resolution status.
 * Optionally re-simulates level checks against stored candle returns to verify
 * that outcomes match what the checker would produce.
 *
 * Usage:  tsx src/scripts/debug-outcome-checker.ts [BTC|ETH]
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import chalk from "chalk";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TAU_HOURS = 72;

function timeDecay(hoursAfter: number): number {
  return Math.exp(-hoursAfter / TAU_HOURS);
}

function expectedQuality(returnPct: number, hoursAfter: number): number {
  return returnPct * timeDecay(hoursAfter);
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtPrice(v: number): string {
  return v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}` : `$${v.toFixed(4)}`;
}

function fmtHours(h: number): string {
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function outcomeIcon(outcome: string): string {
  if (outcome === "WIN") return chalk.green("WIN ");
  if (outcome === "LOSS") return chalk.red("LOSS");
  return chalk.yellow("OPEN");
}

function directionIcon(dir: string): string {
  if (dir === "LONG") return chalk.green("▲ LONG ");
  if (dir === "SHORT") return chalk.red("▼ SHORT");
  return chalk.yellow("◆ FLAT ");
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const assetFilter = process.argv[2]?.toUpperCase();

  const ideas = await prisma.tradeIdea.findMany({
    where: assetFilter ? { asset: assetFilter as "BTC" | "ETH" } : undefined,
    include: {
      levels: { orderBy: { type: "asc" } },
      returns: { orderBy: { hoursAfter: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (ideas.length === 0) {
    console.log(chalk.dim("No trade ideas found."));
    return;
  }

  console.log(`\n📊 Outcome Checker Debug — ${assetFilter ?? "ALL"}\n`);
  console.log(`  Found ${ideas.length} trade idea(s)\n`);

  // ─── Aggregate stats ────────────────────────────────────────────────────────

  let totalLevels = 0;
  let openLevels = 0;
  let winLevels = 0;
  let lossLevels = 0;
  const qualityScores: number[] = [];

  for (const idea of ideas) {
    for (const level of idea.levels) {
      totalLevels++;
      if (level.outcome === "OPEN") openLevels++;
      else if (level.outcome === "WIN") winLevels++;
      else if (level.outcome === "LOSS") lossLevels++;
      if (level.qualityScore != null) qualityScores.push(level.qualityScore);
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AGGREGATE STATS");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Total ideas         : ${ideas.length}`);
  console.log(`  Total levels        : ${totalLevels}`);
  console.log(`  Open                : ${openLevels}`);
  console.log(`  Wins                : ${winLevels}`);
  console.log(`  Losses              : ${lossLevels}`);
  if (qualityScores.length > 0) {
    const avg = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
    const min = Math.min(...qualityScores);
    const max = Math.max(...qualityScores);
    console.log(`  Quality scores      : avg=${avg.toFixed(2)}  min=${min.toFixed(2)}  max=${max.toFixed(2)}`);
  }
  console.log();

  // ─── Per-idea details ───────────────────────────────────────────────────────

  for (const idea of ideas) {
    const age = Math.round((Date.now() - idea.createdAt.getTime()) / (1000 * 60 * 60));
    const allResolved = idea.levels.every((l) => l.outcome !== "OPEN");

    console.log("───────────────────────────────────────────────────────────────");
    console.log(
      `  ${directionIcon(idea.direction)}  ${chalk.bold(idea.asset)}  ` +
        `entry=${fmtPrice(idea.entryPrice)}  ` +
        `composite=${fmtPrice(idea.compositeTarget)}  ` +
        `age=${fmtHours(age)}  ` +
        `${allResolved ? chalk.dim("[RESOLVED]") : chalk.yellow("[TRACKING]")}`,
    );
    console.log(`  ID: ${idea.id}  Created: ${idea.createdAt.toISOString()}`);

    // Confluence
    if (idea.confluence) {
      const c = idea.confluence as Record<string, number>;
      const dims = ["derivatives", "etfs", "htf", "sentiment", "exchangeFlows"] as const;
      const parts = dims.map((k) => {
        const v = c[k] ?? 0;
        const icon = v > 0 ? chalk.green(`+${v}`) : v < 0 ? chalk.red(`${v}`) : chalk.dim("0");
        return `${k}=${icon}`;
      });
      const total = c.total ?? dims.reduce((sum, k) => sum + (c[k] ?? 0), 0);
      const totalIcon = total >= 300 ? chalk.green.bold(total) : total > 0 ? chalk.yellow(total) : chalk.red(total);
      console.log(`  Confluence: ${parts.join("  ")}  total=${totalIcon}`);
    }

    // Levels
    console.log();
    console.log(`  Levels:`);
    for (const level of idea.levels) {
      const typeIcon = level.type === "TARGET" ? "🎯" : "🛑";
      const resolvedInfo = level.resolvedAt
        ? `  resolved=${level.resolvedAt.toISOString().slice(0, 16)}`
        : "";
      const qualityInfo = level.qualityScore != null ? `  quality=${level.qualityScore.toFixed(3)}` : "";

      console.log(
        `    ${typeIcon} ${level.label.padEnd(6)} ` +
          `price=${fmtPrice(level.price).padEnd(12)} ` +
          `${outcomeIcon(level.outcome)}${qualityInfo}${resolvedInfo}`,
      );

      // Verify quality score if resolved
      if (level.resolvedAt && level.qualityScore != null) {
        const hoursToResolve = Math.round(
          (level.resolvedAt.getTime() - idea.createdAt.getTime()) / (1000 * 60 * 60),
        );
        const returnPctAtResolve = ((level.price - idea.entryPrice) / idea.entryPrice) * 100;
        const directedReturn = idea.direction === "SHORT" ? -returnPctAtResolve : returnPctAtResolve;
        const expected = expectedQuality(
          level.outcome === "LOSS" && idea.direction === "FLAT"
            ? -Math.abs(directedReturn)
            : directedReturn,
          hoursToResolve,
        );
        const diff = Math.abs(expected - level.qualityScore);
        if (diff > 0.5) {
          console.log(
            chalk.yellow(
              `      ⚠ Quality mismatch: stored=${level.qualityScore.toFixed(3)} ` +
                `expected≈${expected.toFixed(3)} (delta=${diff.toFixed(3)}, ` +
                `hoursToResolve=${hoursToResolve}, returnPct≈${directedReturn.toFixed(2)}%)`,
            ),
          );
          console.log(
            chalk.dim(
              `        Note: expected is approximate — actual uses candle close, not level price`,
            ),
          );
        }
      }
    }

    // Returns curve summary
    if (idea.returns.length > 0) {
      console.log();
      console.log(`  Returns curve: ${idea.returns.length} data points`);

      const first = idea.returns[0]!;
      const last = idea.returns[idea.returns.length - 1]!;
      const maxReturn = idea.returns.reduce((best, r) =>
        Math.abs(r.returnPct) > Math.abs(best.returnPct) ? r : best,
      );
      const minReturn = idea.returns.reduce((worst, r) =>
        r.returnPct < worst.returnPct ? r : worst,
      );

      console.log(`    First  : t=${fmtHours(first.hoursAfter).padEnd(6)} return=${fmtPct(first.returnPct).padEnd(8)} price=${fmtPrice(first.price)}`);
      console.log(`    Last   : t=${fmtHours(last.hoursAfter).padEnd(6)} return=${fmtPct(last.returnPct).padEnd(8)} price=${fmtPrice(last.price)}`);
      console.log(`    Peak   : t=${fmtHours(maxReturn.hoursAfter).padEnd(6)} return=${fmtPct(maxReturn.returnPct).padEnd(8)} price=${fmtPrice(maxReturn.price)}`);
      console.log(`    Trough : t=${fmtHours(minReturn.hoursAfter).padEnd(6)} return=${fmtPct(minReturn.returnPct).padEnd(8)} price=${fmtPrice(minReturn.price)}`);

      // Mini ASCII chart of returns
      console.log();
      console.log(`  Returns sparkline:`);
      const returns = idea.returns.map((r) => r.returnPct);
      const rMin = Math.min(...returns);
      const rMax = Math.max(...returns);
      const range = rMax - rMin || 1;
      const chartWidth = 50;
      const step = Math.max(1, Math.floor(idea.returns.length / chartWidth));
      const sampled = idea.returns.filter((_, i) => i % step === 0);

      const zeroPos = Math.round(((0 - rMin) / range) * 30);
      let sparkline = "    ";
      for (const r of sampled) {
        const pos = Math.round(((r.returnPct - rMin) / range) * 30);
        if (r.returnPct >= 0) sparkline += chalk.green("▄");
        else sparkline += chalk.red("▄");
      }
      console.log(sparkline);
      console.log(`    ${fmtPct(rMin)} ... ${fmtPct(rMax)}`);
    } else {
      console.log(chalk.dim(`\n  No return data points yet`));
    }

    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
