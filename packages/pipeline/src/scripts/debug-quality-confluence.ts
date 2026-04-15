/**
 * Analyze high-quality trade ideas (|quality| >= 3) to identify which
 * confluence dimensions contribute most to successful signal generation.
 *
 * Usage:  tsx src/scripts/debug-quality-confluence.ts [BTC|ETH]
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import chalk from "chalk";
import type { AssetType } from "../types.js";

// ─── types ──────────────────────────────────────────────────────────────────

interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
}

const DIMENSIONS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
type Dim = (typeof DIMENSIONS)[number];

const DIM_LABELS: Record<Dim, string> = {
  derivatives: "Derivatives",
  etfs: "ETFs",
  htf: "HTF",
  exchangeFlows: "Exch Flows",
};

const QUALITY_THRESHOLD = 2;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Format a -1..+1 normalized score as a signed percentage. */
function fmtScore(v: number): string {
  const pctVal = Math.round(v * 100);
  const s = pctVal >= 0 ? `+${pctVal}%` : `${pctVal}%`;
  if (v >= 0.5) return chalk.green.bold(s);
  if (v >= 0.2) return chalk.green(s);
  if (v <= -0.5) return chalk.red.bold(s);
  if (v <= -0.2) return chalk.red(s);
  return chalk.dim(s);
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function bar(value: number, max: number, width: number): string {
  const filled = Math.round((Math.abs(value) / max) * width);
  const ch = value >= 0 ? chalk.green("█") : chalk.red("█");
  const empty = chalk.dim("░");
  return (value >= 0 ? ch : ch).repeat(Math.min(filled, width)) + empty.repeat(Math.max(0, width - filled));
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as AssetType;
  console.log(`\n🔍 High-Quality Signal Confluence Analysis — ${asset}\n`);

  // Fetch all trade ideas with returns and confluence
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset },
    include: { returns: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total trade ideas: ${ideas.length}\n`);

  // Find peak quality for each idea
  type IdeaWithPeak = {
    id: string;
    direction: string;
    skipped: boolean;
    confluence: Confluence;
    createdAt: Date;
    peakQuality: number;
    peakReturnPct: number;
    peakHoursAfter: number;
  };

  const analyzed: IdeaWithPeak[] = [];

  for (const idea of ideas) {
    if (!idea.confluence || idea.returns.length === 0) continue;
    const conf = idea.confluence as unknown as Confluence;

    const peak = idea.returns.reduce((best, r) =>
      Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
    );

    analyzed.push({
      id: idea.id,
      direction: idea.direction,
      skipped: idea.skipped,
      confluence: conf,
      createdAt: idea.createdAt,
      peakQuality: peak.qualityAtPoint,
      peakReturnPct: peak.returnPct,
      peakHoursAfter: peak.hoursAfter,
    });
  }

  // Split into high-quality correct (q >= 3) and high-quality wrong (q <= -3)
  const highCorrect = analyzed.filter((a) => a.peakQuality >= QUALITY_THRESHOLD);
  const highWrong = analyzed.filter((a) => a.peakQuality <= -QUALITY_THRESHOLD);
  const lowQuality = analyzed.filter((a) => Math.abs(a.peakQuality) < QUALITY_THRESHOLD);

  console.log(`With returns data: ${analyzed.length}`);
  console.log(
    `  ${chalk.green(`Quality ≥ ${QUALITY_THRESHOLD} (correct)`)} : ${highCorrect.length}  (${((highCorrect.length / analyzed.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  ${chalk.red(`Quality ≤ -${QUALITY_THRESHOLD} (wrong)`)}  : ${highWrong.length}  (${((highWrong.length / analyzed.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  ${chalk.dim(`|Quality| < ${QUALITY_THRESHOLD} (meh)`)}    : ${lowQuality.length}  (${((lowQuality.length / analyzed.length) * 100).toFixed(0)}%)`,
  );

  // ── Per-dimension analysis ────────────────────────────────────────────────

  function analyzeGroup(group: IdeaWithPeak[], label: string, color: typeof chalk.green) {
    if (group.length === 0) return;

    console.log(`\n${"═".repeat(65)}`);
    console.log(`  ${color.bold(label)} (n=${group.length})`);
    console.log(`${"═".repeat(65)}`);

    // Average scores per dimension
    const avgScores: Record<Dim, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };
    const absAvgScores: Record<Dim, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };
    const agreementCount: Record<Dim, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };
    const strongCount: Record<Dim, number> = { derivatives: 0, etfs: 0, htf: 0, exchangeFlows: 0 };

    for (const idea of group) {
      for (const dim of DIMENSIONS) {
        const score = idea.confluence[dim];
        avgScores[dim] += score;
        absAvgScores[dim] += Math.abs(score);
        if (score > 0) agreementCount[dim]++;
        if (score >= 0.5) strongCount[dim]++;
      }
    }

    const n = group.length;

    console.log(`\n  ${chalk.underline("Average Confluence Scores")}\n`);
    for (const dim of DIMENSIONS) {
      const avg = avgScores[dim] / n;
      const absAvg = absAvgScores[dim] / n;
      console.log(
        `    ${DIM_LABELS[dim].padEnd(14)} ${bar(avg, 1, 30)}  avg: ${fmtScore(avg).padStart(14)}  |avg|: ${chalk.bold((absAvg * 100).toFixed(0) + "%").padStart(5)}`,
      );
    }
    console.log(
      `    ${"Total".padEnd(14)} ${" ".repeat(30)}  avg: ${fmtScore(DIMENSIONS.reduce((s, d) => s + avgScores[d], 0) / n).padStart(14)}`,
    );

    console.log(`\n  ${chalk.underline("Agreement Rate (score > 0)")}\n`);
    for (const dim of DIMENSIONS) {
      const rate = (agreementCount[dim] / n) * 100;
      const strongRate = (strongCount[dim] / n) * 100;
      console.log(
        `    ${DIM_LABELS[dim].padEnd(14)} ${bar(rate, 100, 30)}  ${rate.toFixed(0).padStart(3)}%  (strong ≥+50%: ${strongRate.toFixed(0)}%)`,
      );
    }

    // Contribution weight: which dimension contributed most to total conviction
    console.log(`\n  ${chalk.underline("Share of Total Conviction")}\n`);
    const totalAbsAvg = DIMENSIONS.reduce((s, d) => s + absAvgScores[d], 0);
    const shares = DIMENSIONS.map((d) => ({
      dim: d,
      share: totalAbsAvg > 0 ? (absAvgScores[d] / totalAbsAvg) * 100 : 25,
    })).sort((a, b) => b.share - a.share);

    for (const { dim, share } of shares) {
      console.log(`    ${DIM_LABELS[dim].padEnd(14)} ${bar(share, 100, 30)}  ${share.toFixed(1)}%`);
    }

    // Taken vs skipped
    const taken = group.filter((g) => !g.skipped).length;
    const skipped = group.filter((g) => g.skipped).length;
    console.log(`\n  Taken: ${taken}  |  Skipped: ${skipped}`);
  }

  analyzeGroup(highCorrect, `HIGH QUALITY CORRECT (q ≥ ${QUALITY_THRESHOLD})`, chalk.green);
  analyzeGroup(highWrong, `HIGH QUALITY WRONG (q ≤ -${QUALITY_THRESHOLD})`, chalk.red);
  analyzeGroup(lowQuality, `LOW QUALITY (|q| < ${QUALITY_THRESHOLD})`, chalk.yellow);

  // ── Comparative: correct vs wrong dimension dominance ─────────────────────

  if (highCorrect.length > 0 && highWrong.length > 0) {
    console.log(`\n${"═".repeat(65)}`);
    console.log(`  ${chalk.bold.cyan("COMPARATIVE: Correct vs Wrong")}`);
    console.log(`${"═".repeat(65)}\n`);

    console.log(`  ${chalk.underline("Avg Score Difference (correct - wrong)")}\n`);

    for (const dim of DIMENSIONS) {
      const correctAvg = highCorrect.reduce((s, i) => s + i.confluence[dim], 0) / highCorrect.length;
      const wrongAvg = highWrong.reduce((s, i) => s + i.confluence[dim], 0) / highWrong.length;
      const delta = correctAvg - wrongAvg;
      console.log(
        `    ${DIM_LABELS[dim].padEnd(14)} correct: ${fmtScore(correctAvg).padStart(8)}  wrong: ${fmtScore(wrongAvg).padStart(8)}  Δ: ${fmtScore(delta).padStart(8)}`,
      );
    }
  }

  // ── Per-idea detail for high quality ──────────────────────────────────────

  function printIdeas(group: IdeaWithPeak[], label: string) {
    if (group.length === 0) return;

    console.log(`\n${"─".repeat(65)}`);
    console.log(`  ${label} — Individual Ideas`);
    console.log(`${"─".repeat(65)}`);

    const sorted = [...group].sort((a, b) => Math.abs(b.peakQuality) - Math.abs(a.peakQuality));

    for (const idea of sorted) {
      const dir = idea.direction === "LONG" ? chalk.green("LONG ") : chalk.red("SHORT");
      const skip = idea.skipped ? chalk.dim(" (skipped)") : "";
      const date = idea.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const qColor = idea.peakQuality >= 0 ? chalk.green : chalk.red;

      console.log(
        `\n  ${date}  ${dir}${skip}  peak: ${fmtPct(idea.peakReturnPct)} at ${idea.peakHoursAfter}h  quality: ${qColor.bold(idea.peakQuality.toFixed(2))}`,
      );
      for (const dim of DIMENSIONS) {
        console.log(`    ${DIM_LABELS[dim].padEnd(14)} ${fmtScore(idea.confluence[dim])}`);
      }
      console.log(`    ${"Total".padEnd(14)} ${fmtScore(idea.confluence.total)}`);
    }
  }

  printIdeas(highCorrect, "HIGH QUALITY CORRECT");
  printIdeas(highWrong, "HIGH QUALITY WRONG");

  console.log();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
