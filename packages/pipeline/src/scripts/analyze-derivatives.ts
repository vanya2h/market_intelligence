/**
 * Deep derivatives analysis — break down the 4 sub-components
 * to identify which ones are inverted and why.
 *
 * Usage:  tsx src/scripts/analyze-derivatives.ts
 */

import "../env.js";
import { prisma } from "../storage/db.js";
import chalk from "chalk";
import type { HtfContext } from "../htf/types.js";

interface DerivativesContext {
  positioning: { state: string };
  stress: { state: string };
  coinbasePremium: { percentile: { "1m": number } };
  signals: {
    fundingPct1m: number;
    oiZScore30d: number;
    oiChange24h: number;
    oiChange7d: number;
    liqPct1m: number;
    liqPct3m: number;
    fundingPressureCycles: number;
    fundingPressureSide: "LONG" | "SHORT" | null;
  };
}

interface Confluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Replicate sub-component scoring from confluence.ts
function decompose(ctx: DerivativesContext, direction: string, htfCtx?: HtfContext) {
  const { positioning, stress, signals } = ctx;
  const flip = direction === "SHORT" ? -1 : 1;

  // 1. Positioning
  let posScore = 0;
  switch (positioning.state) {
    case "CROWDED_SHORT": {
      const fundingDepth = clamp((20 - signals.fundingPct1m) / 20, 0, 1);
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1);
      posScore = 60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4);
      break;
    }
    case "CROWDED_LONG": {
      const fundingDepth = clamp((signals.fundingPct1m - 80) / 20, 0, 1);
      const oiPressure = clamp(signals.oiZScore30d / 2, 0, 1);
      posScore = -(60 + 40 * (fundingDepth * 0.6 + oiPressure * 0.4));
      break;
    }
    default: {
      const z = signals.oiZScore30d;
      const extremeZ = Math.sign(-z) * Math.max(Math.abs(z) - 1.5, 0);
      posScore = clamp(extremeZ / 1.5, -1, 1) * 40;
    }
  }

  // 2. Stress
  let stressScore = 0;
  switch (stress.state) {
    case "CAPITULATION": {
      const liqIntensity = clamp((signals.liqPct3m - 90) / 10, 0, 1);
      const oiDrop = clamp((-signals.oiChange24h - 0.1) / 0.1, 0, 1);
      stressScore = 70 + 30 * (liqIntensity * 0.5 + oiDrop * 0.5);
      break;
    }
    case "UNWINDING": {
      const liqIntensity = clamp((signals.liqPct1m - 70) / 30, 0, 1);
      const oiDrop = clamp((-signals.oiChange24h - 0.05) / 0.1, 0, 1);
      stressScore = 40 + 40 * (liqIntensity * 0.5 + oiDrop * 0.5);
      break;
    }
    default: {
      const liqBase = clamp((signals.liqPct1m - 70) / 30, 0, 1) * 25;
      const oiAbs = Math.abs(signals.oiChange24h);
      const oiExtreme = Math.sign(-signals.oiChange24h) * Math.max(oiAbs - 0.05, 0);
      const oiChangeBase = clamp(oiExtreme / 0.08, -1, 1) * 20;
      stressScore = liqBase + oiChangeBase;
    }
  }

  // 3. Funding — phase-based (matches confluence.ts scoreFunding)
  const fp = signals.fundingPct1m;
  const cycles = signals.fundingPressureCycles ?? 0;
  const side = signals.fundingPressureSide ?? null;

  // Exhaustion from HTF momentum
  let exhaustion = 0;
  if (htfCtx && side) {
    const cvd = htfCtx.cvd;
    const exhaustionAligns =
      (side === "LONG" && cvd.futures.divergence === "BEARISH") ||
      (side === "SHORT" && cvd.futures.divergence === "BULLISH");
    if (exhaustionAligns && cvd.futures.divergenceMechanism === "EXHAUSTION") exhaustion += 0.35;
    else if (exhaustionAligns && cvd.futures.divergenceMechanism === "ABSORPTION") exhaustion += 0.2;
    if (side === "LONG" && cvd.spotFuturesDivergence === "SUSPECT_BOUNCE") exhaustion += 0.25;
    if (side === "SHORT" && cvd.spotFuturesDivergence === "SPOT_LEADS") exhaustion += 0.25;
    const rsi = htfCtx.rsi.h4;
    if (side === "LONG" && rsi > 70) exhaustion += 0.2 * Math.min((rsi - 70) / 15, 1);
    else if (side === "SHORT" && rsi < 30) exhaustion += 0.2 * Math.min((30 - rsi) / 15, 1);
    if (signals.oiChange24h < -0.02 || signals.oiChange7d < -0.05) exhaustion += 0.2;
    exhaustion = Math.min(exhaustion, 1);
  }

  const effectiveCycles = cycles + exhaustion * 6;
  const trendWeight = Math.exp(-Math.max(effectiveCycles - 1, 0) / 5);
  const fpDeviation = fp - 50;
  const fpDeadZone = 20;
  const fpScaled = Math.sign(fpDeviation) * Math.max(Math.abs(fpDeviation) - fpDeadZone, 0);
  const meanRevScore = -100 * Math.tanh(fpScaled / 12);
  const trendScore = side !== null ? -meanRevScore : 0;
  const fundingScore = clamp(trendWeight * trendScore + (1 - trendWeight) * meanRevScore, -100, 100);

  // 4. Coinbase premium
  const cbPctl = ctx.coinbasePremium.percentile["1m"];
  const cbDeviation = cbPctl - 50;
  const cbDeadZone = 15;
  const cbScaled = Math.sign(cbDeviation) * Math.max(Math.abs(cbDeviation) - cbDeadZone, 0);
  const cbScore = 100 * Math.tanh(cbScaled / 15);

  return {
    positioning: posScore * flip,
    stress: stressScore * flip,
    funding: fundingScore * flip,
    cbPremium: cbScore * flip,
    positioningState: positioning.state,
    stressState: stress.state,
    fundingPctl: fp,
    cbPctl,
    oiZ: signals.oiZScore30d,
    exhaustion,
    trendWeight,
    fundingCycles: cycles,
  };
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(n: number, d: number): string {
  return d === 0 ? "N/A" : `${((n / d) * 100).toFixed(1)}%`;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 5) return 0;
  const mx = avg(x);
  const my = avg(y);
  let num = 0, dx2 = 0, dy2 = 0;
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

async function main() {
  const ideas = await prisma.tradeIdea.findMany({
    include: {
      returns: { orderBy: { hoursAfter: "asc" } },
      brief: {
        include: {
          derivatives: true,
          htf: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n📊 Derivatives Signal Deep Analysis\n`);

  for (const asset of ["BTC", "ETH"] as const) {
    const assetIdeas = ideas.filter((i) => i.asset === asset && i.returns.length > 0 && i.brief?.derivatives?.context);

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${chalk.bold(asset)} (n=${assetIdeas.length})`);
    console.log(`${"═".repeat(70)}`);

    const rows = assetIdeas.map((idea) => {
      const ctx = idea.brief!.derivatives!.context as unknown as DerivativesContext;
      const htfCtx = idea.brief!.htf?.context as unknown as HtfContext | undefined;
      const components = decompose(ctx, idea.direction, htfCtx);
      const peak = idea.returns.reduce((best, r) =>
        Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
      );
      return { ...components, peakQuality: peak.qualityAtPoint, direction: idea.direction, confluence: idea.confluence as unknown as Confluence, createdAt: idea.createdAt };
    });

    // IC per sub-component
    const outcomes = rows.map((r) => (r.peakQuality > 0 ? 1 : -1));

    console.log(`\n  ${chalk.underline("Sub-Component Information Coefficients")}\n`);

    for (const comp of ["positioning", "stress", "funding", "cbPremium"] as const) {
      const scores = rows.map((r) => r[comp]);
      const ic = pearson(scores, outcomes);
      const avgCorrect = avg(rows.filter((r) => r.peakQuality > 0).map((r) => r[comp]));
      const avgWrong = avg(rows.filter((r) => r.peakQuality <= 0).map((r) => r[comp]));
      const icColor = Math.abs(ic) > 0.1 ? (ic > 0 ? chalk.green : chalk.red) : chalk.dim;

      console.log(
        `    ${comp.padEnd(14)} IC=${icColor(ic.toFixed(3).padStart(7))}  ` +
          `correct_avg=${avgCorrect.toFixed(1).padStart(6)}  ` +
          `wrong_avg=${avgWrong.toFixed(1).padStart(6)}  ` +
          `Δ=${(avgCorrect - avgWrong).toFixed(1).padStart(6)}`,
      );
    }

    // Positioning state distribution + win rates
    console.log(`\n  ${chalk.underline("Positioning State → Win Rate")}\n`);
    const posStates = [...new Set(rows.map((r) => r.positioningState))];
    for (const state of posStates) {
      const inState = rows.filter((r) => r.positioningState === state);
      const wins = inState.filter((r) => r.peakQuality > 0);
      const avgConf = avg(inState.map((r) => r.confluence.derivatives));
      console.log(
        `    ${state.padEnd(18)} n=${String(inState.length).padEnd(4)} ` +
          `win=${pct(wins.length, inState.length).padStart(6)}  ` +
          `avg deriv conf=${(avgConf * 100).toFixed(0)}%`,
      );
    }

    // Stress state distribution + win rates
    console.log(`\n  ${chalk.underline("Stress State → Win Rate")}\n`);
    const stressStates = [...new Set(rows.map((r) => r.stressState))];
    for (const state of stressStates) {
      const inState = rows.filter((r) => r.stressState === state);
      const wins = inState.filter((r) => r.peakQuality > 0);
      console.log(
        `    ${state.padEnd(18)} n=${String(inState.length).padEnd(4)} win=${pct(wins.length, inState.length).padStart(6)}`,
      );
    }

    // Funding percentile buckets
    console.log(`\n  ${chalk.underline("Funding Percentile → Win Rate")}\n`);
    const fBuckets = [
      { min: 0, max: 20, label: "0-20 (shorts paying)" },
      { min: 20, max: 35, label: "20-35" },
      { min: 35, max: 65, label: "35-65 (dead zone)" },
      { min: 65, max: 80, label: "65-80" },
      { min: 80, max: 100, label: "80-100 (longs paying)" },
    ];
    for (const b of fBuckets) {
      const inBucket = rows.filter((r) => r.fundingPctl >= b.min && r.fundingPctl < b.max);
      if (inBucket.length === 0) continue;
      const wins = inBucket.filter((r) => r.peakQuality > 0);
      console.log(
        `    ${b.label.padEnd(28)} n=${String(inBucket.length).padEnd(4)} win=${pct(wins.length, inBucket.length).padStart(6)}  avgQ=${avg(inBucket.map((r) => r.peakQuality)).toFixed(2)}`,
      );
    }

    // OI Z-score buckets
    console.log(`\n  ${chalk.underline("OI Z-Score → Win Rate")}\n`);
    const oiBuckets = [
      { min: -3, max: -1.5, label: "z < -1.5 (depressed)" },
      { min: -1.5, max: -0.5, label: "-1.5..-0.5" },
      { min: -0.5, max: 0.5, label: "-0.5..0.5 (normal)" },
      { min: 0.5, max: 1.5, label: "0.5..1.5" },
      { min: 1.5, max: 5, label: "z > 1.5 (elevated)" },
    ];
    for (const b of oiBuckets) {
      const inBucket = rows.filter((r) => r.oiZ >= b.min && r.oiZ < b.max);
      if (inBucket.length === 0) continue;
      const wins = inBucket.filter((r) => r.peakQuality > 0);
      console.log(
        `    ${b.label.padEnd(28)} n=${String(inBucket.length).padEnd(4)} win=${pct(wins.length, inBucket.length).padStart(6)}  avgQ=${avg(inBucket.map((r) => r.peakQuality)).toFixed(2)}`,
      );
    }

    // CB Premium percentile buckets
    console.log(`\n  ${chalk.underline("Coinbase Premium Pctl → Win Rate")}\n`);
    const cbBuckets = [
      { min: 0, max: 20, label: "0-20 (offshore buying)" },
      { min: 20, max: 35, label: "20-35" },
      { min: 35, max: 65, label: "35-65 (dead zone)" },
      { min: 65, max: 80, label: "65-80" },
      { min: 80, max: 100, label: "80-100 (US buying)" },
    ];
    for (const b of cbBuckets) {
      const inBucket = rows.filter((r) => r.cbPctl >= b.min && r.cbPctl < b.max);
      if (inBucket.length === 0) continue;
      const wins = inBucket.filter((r) => r.peakQuality > 0);
      console.log(
        `    ${b.label.padEnd(28)} n=${String(inBucket.length).padEnd(4)} win=${pct(wins.length, inBucket.length).padStart(6)}  avgQ=${avg(inBucket.map((r) => r.peakQuality)).toFixed(2)}`,
      );
    }

    // Direction × derivatives agreement
    console.log(`\n  ${chalk.underline("Direction × Derivatives Agreement")}\n`);
    for (const dir of ["LONG", "SHORT"] as const) {
      const dirRows = rows.filter((r) => r.direction === dir);
      if (dirRows.length === 0) continue;
      const aligned = dirRows.filter((r) => r.confluence.derivatives > 0.1);
      const opposing = dirRows.filter((r) => r.confluence.derivatives < -0.1);
      const neutral = dirRows.filter((r) => Math.abs(r.confluence.derivatives) <= 0.1);

      console.log(`    ${dir}:`);
      if (aligned.length > 0)
        console.log(
          `      Aligned   n=${String(aligned.length).padEnd(4)} win=${pct(aligned.filter((r) => r.peakQuality > 0).length, aligned.length).padStart(6)}  avgQ=${avg(aligned.map((r) => r.peakQuality)).toFixed(2)}`,
        );
      if (neutral.length > 0)
        console.log(
          `      Neutral   n=${String(neutral.length).padEnd(4)} win=${pct(neutral.filter((r) => r.peakQuality > 0).length, neutral.length).padStart(6)}  avgQ=${avg(neutral.map((r) => r.peakQuality)).toFixed(2)}`,
        );
      if (opposing.length > 0)
        console.log(
          `      Opposing  n=${String(opposing.length).padEnd(4)} win=${pct(opposing.filter((r) => r.peakQuality > 0).length, opposing.length).padStart(6)}  avgQ=${avg(opposing.map((r) => r.peakQuality)).toFixed(2)}`,
        );
    }

    // When derivatives has HIGH conviction (>0.5 or <-0.5) — what happens?
    console.log(`\n  ${chalk.underline("High Conviction Derivatives (|score| > 0.5)")}\n`);
    const highConv = rows.filter((r) => Math.abs(r.confluence.derivatives) > 0.5);
    const highLong = highConv.filter((r) => r.confluence.derivatives > 0);
    const highShort = highConv.filter((r) => r.confluence.derivatives < 0);

    if (highLong.length > 0) {
      const wins = highLong.filter((r) => r.peakQuality > 0);
      console.log(
        `    High LONG signal  n=${String(highLong.length).padEnd(4)} win=${pct(wins.length, highLong.length).padStart(6)}  avgQ=${avg(highLong.map((r) => r.peakQuality)).toFixed(2)}`,
      );
    }
    if (highShort.length > 0) {
      const wins = highShort.filter((r) => r.peakQuality > 0);
      console.log(
        `    High SHORT signal n=${String(highShort.length).padEnd(4)} win=${pct(wins.length, highShort.length).padStart(6)}  avgQ=${avg(highShort.map((r) => r.peakQuality)).toFixed(2)}`,
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
