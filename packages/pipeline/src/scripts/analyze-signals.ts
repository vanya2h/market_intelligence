/**
 * Deep signal performance analysis — identifies good/bad signals
 * and produces actionable recommendations for weight/parameter tuning.
 *
 * Usage:  tsx src/scripts/analyze-signals.ts
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import chalk from "chalk";

const DIMENSIONS = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
type Dim = (typeof DIMENSIONS)[number];

interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
  bias?: { lean: string; strength: number };
  weights?: Record<Dim, number>;
  sizing?: { positionSizePct: number; conviction: number };
}

interface IdeaRow {
  id: string;
  asset: string;
  direction: string;
  entryPrice: number;
  compositeTarget: number;
  confluence: Confluence;
  createdAt: Date;
  positionSizePct: number;
  levels: {
    type: string;
    label: string;
    price: number;
    outcome: string;
    qualityScore: number | null;
    resolvedAt: Date | null;
  }[];
  returns: {
    hoursAfter: number;
    returnPct: number;
    qualityAtPoint: number;
  }[];
}

// ── Helpers ────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  return d === 0 ? "N/A" : `${((n / d) * 100).toFixed(1)}%`;
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 5) return 0;
  const mx = avg(x);
  const my = avg(y);
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function section(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${chalk.bold(title)}`);
  console.log(`${"═".repeat(70)}`);
}

function subsection(title: string) {
  console.log(`\n  ${chalk.underline(title)}\n`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const rawIdeas = await prisma.tradeIdea.findMany({
    include: {
      levels: { orderBy: { type: "asc" } },
      returns: { orderBy: { hoursAfter: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ideas: IdeaRow[] = rawIdeas
    .filter((i) => i.confluence && i.returns.length > 0)
    .map((i) => ({ ...i, confluence: i.confluence as unknown as Confluence }));

  console.log(`\n📊 Signal Performance Deep Analysis`);
  console.log(`   ${ideas.length} trade ideas with return data (${rawIdeas.length} total)\n`);

  // Compute peak quality per idea
  const withPeak = ideas.map((idea) => {
    const peak = idea.returns.reduce((best, r) =>
      Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
    );
    const maxFavorable = idea.returns.reduce((best, r) =>
      r.returnPct > best.returnPct ? r : best,
    );
    const maxAdverse = idea.returns.reduce((worst, r) =>
      r.returnPct < worst.returnPct ? r : worst,
    );

    // T1 hit rate
    const t1 = idea.levels.find((l) => l.label === "T1");
    const anyInvalidation = idea.levels.filter((l) => l.type === "INVALIDATION" && l.outcome === "LOSS");
    const allInvalidationsLost = idea.levels.filter((l) => l.type === "INVALIDATION").every((l) => l.outcome === "LOSS");

    return {
      ...idea,
      peakQuality: peak.qualityAtPoint,
      peakReturn: peak.returnPct,
      peakHours: peak.hoursAfter,
      maxFavorable: maxFavorable.returnPct,
      maxAdverse: maxAdverse.returnPct,
      t1Hit: t1?.outcome === "WIN",
      allStopsHit: allInvalidationsLost,
      stopsHit: anyInvalidation.length,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. OVERALL DIRECTION ACCURACY
  // ═══════════════════════════════════════════════════════════════════════
  section("1. DIRECTION ACCURACY");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset} (n=${assetIdeas.length})`);

    for (const dir of ["LONG", "SHORT", "FLAT"] as const) {
      const dirIdeas = assetIdeas.filter((i) => i.direction === dir);
      if (dirIdeas.length === 0) continue;

      const correct = dirIdeas.filter((i) => i.peakQuality > 0);
      const t1Hits = dirIdeas.filter((i) => i.t1Hit);
      const avgPeak = avg(dirIdeas.map((i) => i.peakQuality));
      const avgMaxFav = avg(dirIdeas.map((i) => i.maxFavorable));
      const avgMaxAdv = avg(dirIdeas.map((i) => i.maxAdverse));

      console.log(
        `    ${dir.padEnd(6)} n=${String(dirIdeas.length).padEnd(4)} ` +
          `correct=${pct(correct.length, dirIdeas.length).padStart(6)}  ` +
          `T1 hit=${pct(t1Hits.length, dirIdeas.length).padStart(6)}  ` +
          `avgPeakQ=${avgPeak.toFixed(2).padStart(6)}  ` +
          `avgMaxFav=${avgMaxFav.toFixed(2).padStart(6)}%  ` +
          `avgMaxAdv=${avgMaxAdv.toFixed(2).padStart(7)}%`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. PER-DIMENSION IC (Information Coefficient)
  // ═══════════════════════════════════════════════════════════════════════
  section("2. DIMENSION INFORMATION COEFFICIENTS");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    // Binary outcome: 1 if peak quality > 0, -1 otherwise
    const outcomes = assetIdeas.map((i) => (i.peakQuality > 0 ? 1 : -1));

    for (const dim of DIMENSIONS) {
      const scores = assetIdeas.map((i) => i.confluence[dim]);
      const ic = pearson(scores, outcomes);
      const absScores = assetIdeas.map((i) => Math.abs(i.confluence[dim]));
      const avgAbs = avg(absScores);

      // Signal strength when correct vs wrong
      const correctScores = assetIdeas
        .filter((i) => i.peakQuality > 0)
        .map((i) => i.confluence[dim]);
      const wrongScores = assetIdeas
        .filter((i) => i.peakQuality <= 0)
        .map((i) => i.confluence[dim]);

      const icColor = Math.abs(ic) > 0.15 ? (ic > 0 ? chalk.green : chalk.red) : chalk.dim;

      console.log(
        `    ${dim.padEnd(16)} IC=${icColor(ic.toFixed(3).padStart(7))}  ` +
          `|avg|=${(avgAbs * 100).toFixed(0).padStart(3)}%  ` +
          `correct_avg=${(avg(correctScores) * 100).toFixed(0).padStart(4)}%  ` +
          `wrong_avg=${(avg(wrongScores) * 100).toFixed(0).padStart(4)}%  ` +
          `Δ=${((avg(correctScores) - avg(wrongScores)) * 100).toFixed(0).padStart(4)}%`,
      );
    }

    // Also compute IC for the total confluence score
    const totalScores = assetIdeas.map((i) => i.confluence.total);
    const totalIC = pearson(totalScores, outcomes);
    console.log(
      `    ${"TOTAL".padEnd(16)} IC=${(Math.abs(totalIC) > 0.15 ? (totalIC > 0 ? chalk.green : chalk.red) : chalk.dim)(totalIC.toFixed(3).padStart(7))}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CONFLUENCE THRESHOLD ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  section("3. CONFLUENCE TOTAL vs OUTCOME");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset} — Win rate by confluence total bucket`);

    const buckets = [
      { min: -1, max: -0.1, label: "< -10%" },
      { min: -0.1, max: 0.1, label: "-10..10%" },
      { min: 0.1, max: 0.25, label: "10..25%" },
      { min: 0.25, max: 0.4, label: "25..40%" },
      { min: 0.4, max: 1, label: "> 40%" },
    ];

    for (const b of buckets) {
      const inBucket = assetIdeas.filter((i) => i.confluence.total >= b.min && i.confluence.total < b.max);
      const correct = inBucket.filter((i) => i.peakQuality > 0);
      const avgQ = avg(inBucket.map((i) => i.peakQuality));
      if (inBucket.length === 0) continue;
      console.log(
        `    ${b.label.padEnd(12)} n=${String(inBucket.length).padEnd(4)} ` +
          `win=${pct(correct.length, inBucket.length).padStart(6)}  ` +
          `avgQ=${avgQ.toFixed(2).padStart(6)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. DIMENSION AGREEMENT ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  section("4. DIMENSION AGREEMENT (how many dims agree with chosen direction)");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    for (let nAgree = 0; nAgree <= 4; nAgree++) {
      const matching = assetIdeas.filter((i) => {
        const count = DIMENSIONS.filter((d) => i.confluence[d] > 0).length;
        return count === nAgree;
      });
      if (matching.length === 0) continue;
      const correct = matching.filter((i) => i.peakQuality > 0);
      const avgQ = avg(matching.map((i) => i.peakQuality));
      console.log(
        `    ${nAgree} dims agree  n=${String(matching.length).padEnd(4)} ` +
          `win=${pct(correct.length, matching.length).padStart(6)}  ` +
          `avgQ=${avgQ.toFixed(2).padStart(6)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. CONTRADICTING DIMENSION ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  section("5. CONTRADICTING DIMENSIONS (dimension opposes chosen direction)");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset} — when a dimension opposes, does it hurt?`);

    for (const dim of DIMENSIONS) {
      const opposing = assetIdeas.filter((i) => i.confluence[dim] < -0.1);
      const aligned = assetIdeas.filter((i) => i.confluence[dim] > 0.1);
      const neutral = assetIdeas.filter((i) => Math.abs(i.confluence[dim]) <= 0.1);

      if (opposing.length === 0 && aligned.length === 0) continue;

      const oppWin = opposing.filter((i) => i.peakQuality > 0);
      const aliWin = aligned.filter((i) => i.peakQuality > 0);
      const neuWin = neutral.filter((i) => i.peakQuality > 0);

      console.log(
        `    ${dim.padEnd(16)} ` +
          `aligned: ${pct(aliWin.length, aligned.length).padStart(6)} (n=${aligned.length})  ` +
          `neutral: ${pct(neuWin.length, neutral.length).padStart(6)} (n=${neutral.length})  ` +
          `opposing: ${pct(oppWin.length, opposing.length).padStart(6)} (n=${opposing.length})`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. TIME-TO-RESOLUTION ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  section("6. TIME-TO-RESOLUTION");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    const correctPeakHours = assetIdeas.filter((i) => i.peakQuality > 0).map((i) => i.peakHours);
    const wrongPeakHours = assetIdeas.filter((i) => i.peakQuality <= 0).map((i) => i.peakHours);

    console.log(`    Correct: median peak at ${median(correctPeakHours)}h  avg ${avg(correctPeakHours).toFixed(0)}h`);
    console.log(`    Wrong:   median peak at ${median(wrongPeakHours)}h  avg ${avg(wrongPeakHours).toFixed(0)}h`);

    // T1 hit speed
    const t1Resolved = assetIdeas
      .filter((i) => {
        const t1 = i.levels.find((l) => l.label === "T1");
        return t1?.outcome === "WIN" && t1.resolvedAt;
      })
      .map((i) => {
        const t1 = i.levels.find((l) => l.label === "T1")!;
        return (t1.resolvedAt!.getTime() - i.createdAt.getTime()) / (1000 * 60 * 60);
      });

    if (t1Resolved.length > 0) {
      console.log(`    T1 hit:  median ${median(t1Resolved).toFixed(0)}h  avg ${avg(t1Resolved).toFixed(0)}h (n=${t1Resolved.length})`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. LEVEL HIT RATES
  // ═══════════════════════════════════════════════════════════════════════
  section("7. LEVEL HIT RATES");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    const labels = ["1:2", "1:3", "1:4", "1:5", "T1", "T2", "T3"];
    for (const label of labels) {
      const levels = assetIdeas.flatMap((i) => i.levels.filter((l) => l.label === label && l.outcome !== "OPEN"));
      const wins = levels.filter((l) => l.outcome === "WIN");
      const losses = levels.filter((l) => l.outcome === "LOSS");
      if (levels.length === 0) continue;

      const icon = label.startsWith("T") ? "🎯" : "🛑";
      console.log(
        `    ${icon} ${label.padEnd(4)} resolved=${String(levels.length).padEnd(4)} ` +
          `win=${pct(wins.length, levels.length).padStart(6)}  ` +
          `loss=${pct(losses.length, levels.length).padStart(6)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. COMPOSITE TARGET QUALITY
  // ═══════════════════════════════════════════════════════════════════════
  section("8. COMPOSITE TARGET DISTANCE vs ACTUAL MOVE");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset && i.direction !== "FLAT");
    subsection(`${asset}`);

    const targetDistances = assetIdeas.map((i) => {
      const targetDist = Math.abs(i.compositeTarget - i.entryPrice) / i.entryPrice * 100;
      return { targetDist, maxFav: i.maxFavorable, maxAdv: i.maxAdverse };
    });

    const avgTargetDist = avg(targetDistances.map((t) => t.targetDist));
    const avgActualFav = avg(targetDistances.map((t) => t.maxFav));

    console.log(`    Avg target distance: ${avgTargetDist.toFixed(2)}%`);
    console.log(`    Avg max favorable:   ${avgActualFav.toFixed(2)}%`);
    console.log(`    Ratio (actual/target): ${(avgActualFav / avgTargetDist).toFixed(2)}x`);

    // Overshoots vs undershoots
    const overshoot = targetDistances.filter((t) => t.maxFav > t.targetDist).length;
    console.log(`    Overshoot rate: ${pct(overshoot, targetDistances.length)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. EXCHANGE FLOWS DEEP DIVE (dominant ETH signal)
  // ═══════════════════════════════════════════════════════════════════════
  section("9. EXCHANGE FLOWS — Deep Dive (dominant for ETH)");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    const strongPositive = assetIdeas.filter((i) => i.confluence.exchangeFlows >= 0.5);
    const strongNegative = assetIdeas.filter((i) => i.confluence.exchangeFlows <= -0.5);
    const weak = assetIdeas.filter((i) => Math.abs(i.confluence.exchangeFlows) < 0.1);

    const spWin = strongPositive.filter((i) => i.peakQuality > 0);
    const snWin = strongNegative.filter((i) => i.peakQuality > 0);
    const wWin = weak.filter((i) => i.peakQuality > 0);

    console.log(
      `    Strong +  n=${String(strongPositive.length).padEnd(4)} win=${pct(spWin.length, strongPositive.length).padStart(6)}  avgQ=${avg(strongPositive.map((i) => i.peakQuality)).toFixed(2)}`,
    );
    console.log(
      `    Strong -  n=${String(strongNegative.length).padEnd(4)} win=${pct(snWin.length, strongNegative.length).padStart(6)}  avgQ=${avg(strongNegative.map((i) => i.peakQuality)).toFixed(2)}`,
    );
    console.log(
      `    Weak/0    n=${String(weak.length).padEnd(4)} win=${pct(wWin.length, weak.length).padStart(6)}  avgQ=${avg(weak.map((i) => i.peakQuality)).toFixed(2)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. HTF SIGNAL ANALYSIS (often contrarian)
  // ═══════════════════════════════════════════════════════════════════════
  section("10. HTF — Does it help or hurt?");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset}`);

    // When HTF agrees vs disagrees with final direction
    const htfAgrees = assetIdeas.filter((i) => i.confluence.htf > 0.1);
    const htfDisagrees = assetIdeas.filter((i) => i.confluence.htf < -0.1);
    const htfNeutral = assetIdeas.filter((i) => Math.abs(i.confluence.htf) <= 0.1);

    for (const [label, group] of [
      ["Agrees", htfAgrees],
      ["Neutral", htfNeutral],
      ["Disagrees", htfDisagrees],
    ] as const) {
      const wins = group.filter((i) => i.peakQuality > 0);
      console.log(
        `    HTF ${label.padEnd(10)} n=${String(group.length).padEnd(4)} ` +
          `win=${pct(wins.length, group.length).padStart(6)}  ` +
          `avgQ=${avg(group.map((i) => i.peakQuality)).toFixed(2).padStart(6)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 11. STREAKS & REGIME PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════
  section("11. CONSECUTIVE SAME-DIRECTION CALLS");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = withPeak.filter((i) => i.asset === asset);
    subsection(`${asset} — do repeated calls in same direction degrade?`);

    let streak = 1;
    for (let i = 1; i < assetIdeas.length; i++) {
      if (assetIdeas[i]!.direction === assetIdeas[i - 1]!.direction) {
        streak++;
      } else {
        streak = 1;
      }
      // Tag streak length onto each idea
      (assetIdeas[i] as Record<string, unknown>)._streak = streak;
    }

    for (const len of [1, 2, 3, 4, 5]) {
      const matching = assetIdeas.filter((i) => {
        const s = (i as Record<string, unknown>)._streak ?? 1;
        return len === 5 ? (s as number) >= 5 : s === len;
      });
      if (matching.length === 0) continue;
      const wins = matching.filter((i) => i.peakQuality > 0);
      console.log(
        `    streak=${len >= 5 ? "5+" : String(len)}  n=${String(matching.length).padEnd(4)} ` +
          `win=${pct(wins.length, matching.length).padStart(6)}  ` +
          `avgQ=${avg(matching.map((i) => i.peakQuality)).toFixed(2).padStart(6)}`,
      );
    }
  }

  console.log(`\n${"═".repeat(70)}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
