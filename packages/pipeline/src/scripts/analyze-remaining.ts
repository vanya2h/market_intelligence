/**
 * Deep analysis of remaining improvement areas:
 * - SHORT direction accuracy (40% BTC, 36% ETH)
 * - ETF signal inversion for ETH
 * - HTF signal inversion for ETH
 * - FLAT direction (0% correct)
 * - Confluence total near-zero IC
 * - Direction switching frequency vs persistence
 *
 * Usage:  tsx src/scripts/analyze-remaining.ts
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
type Dim = (typeof DIMS)[number];

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}
function pct(n: number, d: number): string {
  return d === 0 ? "N/A" : `${((n / d) * 100).toFixed(1)}%`;
}
function section(t: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${chalk.bold(t)}`);
  console.log(`${"═".repeat(70)}`);
}

async function main() {
  const rawIdeas = await prisma.tradeIdea.findMany({
    include: {
      returns: { orderBy: { hoursAfter: "asc" } },
      brief: { include: { etfs: true, htf: true, derivatives: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ideas = rawIdeas
    .filter((i) => i.confluence && i.returns.length > 0)
    .map((i) => {
      const peak = i.returns.reduce((best, r) =>
        Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
      );
      const maxFav = i.returns.reduce((best, r) => (r.returnPct > best.returnPct ? r : best));
      const maxAdv = i.returns.reduce((worst, r) => (r.returnPct < worst.returnPct ? r : worst));
      return {
        ...i,
        conf: i.confluence as unknown as Confluence,
        peakQ: peak.qualityAtPoint,
        peakReturn: peak.returnPct,
        maxFav: maxFav.returnPct,
        maxAdv: maxAdv.returnPct,
      };
    });

  console.log(`\n📊 Remaining Improvement Analysis (${ideas.length} ideas)\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // 1. SHORT vs LONG: What makes SHORT calls fail?
  // ═══════════════════════════════════════════════════════════════════════
  section("1. SHORT SIGNAL ANATOMY — Why 60% of SHORTs are wrong");

  for (const asset of ["BTC", "ETH"] as const) {
    const shorts = ideas.filter((i) => i.asset === asset && i.direction === "SHORT");
    const longs = ideas.filter((i) => i.asset === asset && i.direction === "LONG");
    if (shorts.length === 0) continue;

    console.log(`\n  ${chalk.underline(`${asset} SHORTs (n=${shorts.length})`)}\n`);

    // What does the market actually do after a SHORT call?
    const shortCorrect = shorts.filter((i) => i.peakQ > 0);
    const shortWrong = shorts.filter((i) => i.peakQ <= 0);

    console.log(`    Correct: ${shortCorrect.length}  Wrong: ${shortWrong.length}`);
    console.log(`    Avg max favorable: ${avg(shorts.map((i) => i.maxFav)).toFixed(2)}%`);
    console.log(`    Avg max adverse:   ${avg(shorts.map((i) => i.maxAdv)).toFixed(2)}%`);
    console.log(`    → Market usually moves AGAINST shorts by ${Math.abs(avg(shorts.map((i) => i.maxAdv))).toFixed(2)}%\n`);

    // Dimension scores for correct vs wrong SHORTs
    console.log(`    ${chalk.underline("Dimension scores: correct vs wrong SHORTs")}\n`);
    for (const dim of DIMS) {
      const cAvg = avg(shortCorrect.map((i) => i.conf[dim]));
      const wAvg = avg(shortWrong.map((i) => i.conf[dim]));
      console.log(`      ${dim.padEnd(16)} correct=${(cAvg * 100).toFixed(0).padStart(4)}%  wrong=${(wAvg * 100).toFixed(0).padStart(4)}%  Δ=${((cAvg - wAvg) * 100).toFixed(0).padStart(4)}%`);
    }

    // When was SHORT actually right? What conditions?
    console.log(`\n    ${chalk.underline("Correct SHORT confluence totals")}`);
    for (const s of shortCorrect) {
      const date = s.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      console.log(`      ${date}  total=${(s.conf.total * 100).toFixed(0)}%  peak=${s.peakReturn.toFixed(2)}%  deriv=${(s.conf.derivatives * 100).toFixed(0)}% etf=${(s.conf.etfs * 100).toFixed(0)}% htf=${(s.conf.htf * 100).toFixed(0)}% ef=${(s.conf.exchangeFlows * 100).toFixed(0)}%`);
    }

    // Compare: SHORT total vs LONG total — was SHORT even the stronger signal?
    console.log(`\n    ${chalk.underline("SHORT vs LONG total comparison")}\n`);

    // For each SHORT idea, compute what the LONG total would have been
    // SHORT total = -(LONG total) approximately (scores flip sign)
    // If SHORT total > LONG total, it means more dims agreed with SHORT
    const weakShorts = shorts.filter((i) => i.conf.total < 0.1);
    const strongShorts = shorts.filter((i) => i.conf.total >= 0.1);
    console.log(`    Weak SHORTs (total < 10%):  n=${weakShorts.length}  win=${pct(weakShorts.filter((i) => i.peakQ > 0).length, weakShorts.length)}`);
    console.log(`    Strong SHORTs (total ≥ 10%): n=${strongShorts.length}  win=${pct(strongShorts.filter((i) => i.peakQ > 0).length, strongShorts.length)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. ETF SIGNAL — Why inverted for ETH?
  // ═══════════════════════════════════════════════════════════════════════
  section("2. ETF SIGNAL — Why IC=-0.189 for ETH");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);
    const etfCtxs = assetIdeas.filter((i) => i.brief?.etfs?.context);

    console.log(`\n  ${chalk.underline(`${asset} (n=${etfCtxs.length})`)}\n`);

    // ETF score distribution
    const etfPositive = assetIdeas.filter((i) => i.conf.etfs > 0.05);
    const etfNegative = assetIdeas.filter((i) => i.conf.etfs < -0.05);
    const etfZero = assetIdeas.filter((i) => Math.abs(i.conf.etfs) <= 0.05);

    console.log(`    ETF > +5%:  n=${etfPositive.length}  win=${pct(etfPositive.filter((i) => i.peakQ > 0).length, etfPositive.length)}  avgQ=${avg(etfPositive.map((i) => i.peakQ)).toFixed(2)}`);
    console.log(`    ETF ~0:     n=${etfZero.length}  win=${pct(etfZero.filter((i) => i.peakQ > 0).length, etfZero.length)}  avgQ=${avg(etfZero.map((i) => i.peakQ)).toFixed(2)}`);
    console.log(`    ETF < -5%:  n=${etfNegative.length}  win=${pct(etfNegative.filter((i) => i.peakQ > 0).length, etfNegative.length)}  avgQ=${avg(etfNegative.map((i) => i.peakQ)).toFixed(2)}`);

    // ETH-specific: ETF data is BTC ETF data applied to ETH. Does ETH even follow BTC ETF flows?
    if (asset === "ETH") {
      console.log(`\n    ${chalk.dim("Note: ETF data is BTC-only. ETH ETF score comes from BTC ETF flows.")}`);
      console.log(`    ${chalk.dim("Question: Does ETH reliably follow BTC ETF flow direction?")}\n`);

      // When ETF says positive (BTC inflow) but ETH goes down
      const etfBullishEthDown = etfPositive.filter((i) => i.peakQ <= 0);
      const etfBearishEthUp = etfNegative.filter((i) => i.peakQ > 0);
      console.log(`    ETF bullish but ETH wrong: ${etfBullishEthDown.length}/${etfPositive.length}`);
      console.log(`    ETF bearish but ETH wrong: ${etfBearishEthUp.length}/${etfNegative.length}`);
    }

    // ETF regime distribution
    if (etfCtxs.length > 0) {
      const regimes = new Map<string, { total: number; wins: number }>();
      for (const idea of etfCtxs) {
        const ctx = idea.brief!.etfs!.context as Record<string, unknown>;
        const regime = ctx.regime as string;
        const entry = regimes.get(regime) ?? { total: 0, wins: 0 };
        entry.total++;
        if (idea.peakQ > 0) entry.wins++;
        regimes.set(regime, entry);
      }
      console.log(`\n    ${chalk.underline("ETF Regime → Win Rate")}\n`);
      for (const [regime, data] of regimes) {
        console.log(`      ${regime.padEnd(22)} n=${String(data.total).padEnd(4)} win=${pct(data.wins, data.total)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. HTF SIGNAL — Why opposing = better for ETH?
  // ═══════════════════════════════════════════════════════════════════════
  section("3. HTF — Opposing = 76.7% win for ETH. Why?");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);
    const htfCtxs = assetIdeas.filter((i) => i.brief?.htf?.context);

    console.log(`\n  ${chalk.underline(`${asset} (n=${htfCtxs.length})`)}\n`);

    // Break down HTF bias components when HTF opposes
    const htfOpposes = assetIdeas.filter((i) => i.conf.htf < -0.1);
    const htfAgrees = assetIdeas.filter((i) => i.conf.htf > 0.1);

    if (htfOpposes.length > 0 && htfCtxs.length > 0) {
      console.log(`    ${chalk.underline("When HTF opposes the chosen direction:")}\n`);

      // What direction was chosen when HTF opposes?
      const oppLong = htfOpposes.filter((i) => i.direction === "LONG");
      const oppShort = htfOpposes.filter((i) => i.direction === "SHORT");
      console.log(`      LONG chosen:  n=${oppLong.length}  win=${pct(oppLong.filter((i) => i.peakQ > 0).length, oppLong.length)}`);
      console.log(`      SHORT chosen: n=${oppShort.length}  win=${pct(oppShort.filter((i) => i.peakQ > 0).length, oppShort.length)}`);

      // What other dimensions overrode HTF?
      console.log(`\n      ${chalk.underline("What dims overrode HTF?")}\n`);
      for (const dim of DIMS.filter((d) => d !== "htf")) {
        const dimAgrees = htfOpposes.filter((i) => i.conf[dim] > 0.1);
        const dimWins = dimAgrees.filter((i) => i.peakQ > 0);
        console.log(`        ${dim.padEnd(16)} agreed: ${dimAgrees.length}/${htfOpposes.length}  win when agreed: ${pct(dimWins.length, dimAgrees.length)}`);
      }
    }

    // HTF composite bias vs actual outcome
    if (htfCtxs.length > 0) {
      console.log(`\n    ${chalk.underline("HTF Bias Composite (raw, not directional)")}\n`);
      const biasValues = htfCtxs.filter((i) => {
        const ctx = i.brief!.htf!.context as Record<string, unknown> | null;
        return ctx && ctx.bias;
      }).map((i) => {
        const ctx = i.brief!.htf!.context as Record<string, unknown>;
        const bias = ctx.bias as Record<string, number>;
        return { composite: bias.composite ?? 0, compression: bias.compression ?? 0, momentum: bias.momentum ?? 0, flow: bias.flow ?? 0, trend: bias.trend ?? 0, correct: i.peakQ > 0 };
      });

      // When composite bias magnitude is high vs low
      const highBias = biasValues.filter((b) => Math.abs(b.composite) > 0.3);
      const lowBias = biasValues.filter((b) => Math.abs(b.composite) <= 0.1);
      const midBias = biasValues.filter((b) => Math.abs(b.composite) > 0.1 && Math.abs(b.composite) <= 0.3);

      console.log(`      |composite| > 0.3:  n=${highBias.length}  win=${pct(highBias.filter((b) => b.correct).length, highBias.length)}`);
      console.log(`      |composite| 0.1-0.3: n=${midBias.length}  win=${pct(midBias.filter((b) => b.correct).length, midBias.length)}`);
      console.log(`      |composite| ≤ 0.1:  n=${lowBias.length}  win=${pct(lowBias.filter((b) => b.correct).length, lowBias.length)}`);

      // Compression as a standalone signal
      const compressed = biasValues.filter((b) => (b.compression ?? 0) > 0.5);
      const notCompressed = biasValues.filter((b) => (b.compression ?? 0) <= 0.2);
      console.log(`\n      Compression > 0.5:  n=${compressed.length}  win=${pct(compressed.filter((b) => b.correct).length, compressed.length)}`);
      console.log(`      Compression ≤ 0.2:  n=${notCompressed.length}  win=${pct(notCompressed.filter((b) => b.correct).length, notCompressed.length)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. DIRECTION SWITCHING — does flipping direction work?
  // ═══════════════════════════════════════════════════════════════════════
  section("4. DIRECTION SWITCHING vs PERSISTENCE");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    let flips = 0, persists = 0;
    const flipResults: boolean[] = [];
    const persistResults: boolean[] = [];

    for (let i = 1; i < assetIdeas.length; i++) {
      const prev = assetIdeas[i - 1]!;
      const curr = assetIdeas[i]!;
      const isFlip = curr.direction !== prev.direction;

      if (isFlip) {
        flips++;
        flipResults.push(curr.peakQ > 0);
      } else {
        persists++;
        persistResults.push(curr.peakQ > 0);
      }
    }

    const flipWin = flipResults.filter(Boolean).length;
    const persistWin = persistResults.filter(Boolean).length;
    console.log(`    Flips:    n=${flips}  win=${pct(flipWin, flips)}  avgQ=${avg(flipResults.map((r) => r ? 1 : -1)).toFixed(2)}`);
    console.log(`    Persists: n=${persists}  win=${pct(persistWin, persists)}  avgQ=${avg(persistResults.map((r) => r ? 1 : -1)).toFixed(2)}`);

    // What was the previous idea's outcome when we flip?
    const flipAfterCorrect: boolean[] = [];
    const flipAfterWrong: boolean[] = [];
    for (let i = 1; i < assetIdeas.length; i++) {
      const prev = assetIdeas[i - 1]!;
      const curr = assetIdeas[i]!;
      if (curr.direction !== prev.direction) {
        if (prev.peakQ > 0) flipAfterCorrect.push(curr.peakQ > 0);
        else flipAfterWrong.push(curr.peakQ > 0);
      }
    }
    console.log(`    Flip after correct prev: n=${flipAfterCorrect.length}  win=${pct(flipAfterCorrect.filter(Boolean).length, flipAfterCorrect.length)}`);
    console.log(`    Flip after wrong prev:   n=${flipAfterWrong.length}  win=${pct(flipAfterWrong.filter(Boolean).length, flipAfterWrong.length)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. CONVICTION vs OUTCOME — does higher conviction = better results?
  // ═══════════════════════════════════════════════════════════════════════
  section("5. CONVICTION (total) vs OUTCOME — margin between LONG and SHORT");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(`${asset}`)}\n`);

    // Margin = chosen total - alternative total
    // Since LONG total ≈ -SHORT total, margin ≈ 2 × chosen total
    const withMargin = assetIdeas.map((i) => ({
      ...i,
      margin: i.conf.total * 2, // approximate margin
    }));

    const buckets = [
      { min: 0, max: 0.1, label: "margin < 10%" },
      { min: 0.1, max: 0.3, label: "margin 10-30%" },
      { min: 0.3, max: 0.5, label: "margin 30-50%" },
      { min: 0.5, max: 2, label: "margin > 50%" },
    ];

    for (const b of buckets) {
      const inBucket = withMargin.filter((i) => i.margin >= b.min && i.margin < b.max);
      if (inBucket.length === 0) continue;
      const wins = inBucket.filter((i) => i.peakQ > 0);
      console.log(`    ${b.label.padEnd(18)} n=${String(inBucket.length).padEnd(4)} win=${pct(wins.length, inBucket.length).padStart(6)}  avgQ=${avg(inBucket.map((i) => i.peakQ)).toFixed(2)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. TIME-OF-DAY ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  section("6. TIME-OF-DAY — do certain hours produce better ideas?");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    const byHour = new Map<number, { total: number; wins: number; avgQ: number[] }>();
    for (const idea of assetIdeas) {
      const hour = idea.createdAt.getUTCHours();
      const entry = byHour.get(hour) ?? { total: 0, wins: 0, avgQ: [] };
      entry.total++;
      if (idea.peakQ > 0) entry.wins++;
      entry.avgQ.push(idea.peakQ);
      byHour.set(hour, entry);
    }

    for (const [hour, data] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`    ${String(hour).padStart(2)}:00 UTC  n=${String(data.total).padEnd(4)} win=${pct(data.wins, data.total).padStart(6)}  avgQ=${avg(data.avgQ).toFixed(2)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. DIMENSION PAIR INTERACTIONS
  // ═══════════════════════════════════════════════════════════════════════
  section("7. DIMENSION PAIR INTERACTIONS — which combos predict well?");

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset);

    console.log(`\n  ${chalk.underline(asset)}\n`);

    for (let a = 0; a < DIMS.length; a++) {
      for (let b = a + 1; b < DIMS.length; b++) {
        const dimA = DIMS[a]!;
        const dimB = DIMS[b]!;

        const bothAgree = assetIdeas.filter((i) => i.conf[dimA] > 0.05 && i.conf[dimB] > 0.05);
        const bothOppose = assetIdeas.filter((i) => i.conf[dimA] < -0.05 && i.conf[dimB] < -0.05);
        const disagree = assetIdeas.filter(
          (i) => (i.conf[dimA] > 0.05 && i.conf[dimB] < -0.05) || (i.conf[dimA] < -0.05 && i.conf[dimB] > 0.05),
        );

        if (bothAgree.length < 3 && bothOppose.length < 3 && disagree.length < 3) continue;

        const agreeWin = bothAgree.filter((i) => i.peakQ > 0).length;
        const opposeWin = bothOppose.filter((i) => i.peakQ > 0).length;
        const disagreeWin = disagree.filter((i) => i.peakQ > 0).length;

        console.log(
          `    ${dimA.slice(0, 6)}+${dimB.slice(0, 6).padEnd(6)}  ` +
            `both+: ${pct(agreeWin, bothAgree.length).padStart(6)} (n=${bothAgree.length})  ` +
            `both-: ${pct(opposeWin, bothOppose.length).padStart(6)} (n=${bothOppose.length})  ` +
            `split: ${pct(disagreeWin, disagree.length).padStart(6)} (n=${disagree.length})`,
        );
      }
    }
  }

  console.log(`\n${"═".repeat(70)}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
