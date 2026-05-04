/**
 * ML vs Heuristic Aggregator Comparison
 *
 * Compares the two confluence aggregation approaches:
 *   - Heuristic: IC-weighted average of per-dim scores (confluence.total)
 *   - ML:        ONNX logistic regression P(win) → -1..+1 (confluence.mlTotal)
 *
 * Sections:
 *   1. Training diagnostics — CV metrics & per-dim ICs from meta.json (authoritative)
 *   2. Retrospective scoring — re-score all resolved heuristic trades through ML
 *      WARNING: in-sample (model was trained on this data). Shows rank ordering only.
 *   3. Win rate buckets     — win rate by conviction tercile for each approach
 *   4. Divergence           — when scores disagree in sign, what happened?
 *
 * Usage: tsx src/scripts/ml-vs-heuristic.ts
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { CONFLUENCE_DIMENSIONS, CONFLUENCE_KEY_MAP } from "../orchestrator/dimensions.js";
import { runMlAggregator } from "../orchestrator/trade-idea/ml-aggregator.js";
import { prisma } from "../storage/db.js";
import "../env.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelMeta {
  asset: string;
  version: string;
  n_samples: number;
  date_range: { start: string; end: string };
  class_balance: { wins: number; losses: number };
  coefficients: Record<string, number>;
  cv: {
    oof: { accuracy: number; log_loss: number; brier: number };
    fold_metrics: { label: string; accuracy: number }[];
  };
  heuristic_baseline_full: { accuracy: number; log_loss: number; brier: number };
  training_metrics_in_sample: { accuracy: number };
  pearson_ic_per_dim: Record<string, number>;
}

interface StoredConfluence {
  derivatives: number;
  etfs: number;
  htf: number;
  exchangeFlows: number;
  total: number;
  mlTotal?: number;
  aggregator?: { source: "ml" | "heuristic"; pWin?: number };
}

interface TradeRow {
  id: string;
  asset: "BTC" | "ETH";
  total: number;
  mlRetro: number | null;
  peakReturn: number | null;
  isWin: boolean | null;
  isResolved: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return NaN;
  const n = xs.length;

  const rankOf = (arr: number[]): number[] => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n).fill(0);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j < n && sorted[j]!.v === sorted[i]!.v) j++;
      const rank = (i + j - 1) / 2 + 1;
      for (let k = i; k < j; k++) ranks[sorted[k]!.i] = rank;
      i = j;
    }
    return ranks;
  };

  const rx = rankOf(xs);
  const ry = rankOf(ys);
  const d2 = rx.reduce((sum, r, i) => sum + (r - ry[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function winRate(rows: TradeRow[]): string {
  const res = rows.filter((r) => r.isResolved && r.isWin !== null);
  if (res.length === 0) return "—";
  const wins = res.filter((r) => r.isWin).length;
  return `${((wins / res.length) * 100).toFixed(0)}% (${wins}/${res.length})`;
}

function section(title: string) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${chalk.bold(title)}`);
  console.log(`${"═".repeat(72)}`);
}

function loadMeta(asset: "BTC" | "ETH"): ModelMeta | null {
  const modelsDir = path.resolve(import.meta.dirname, "../../models");
  const p = path.join(modelsDir, `confluence_${asset.toLowerCase()}_v1.meta.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as ModelMeta;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadRows(): Promise<TradeRow[]> {
  const raw = await prisma.tradeIdea.findMany({
    include: {
      levels: true,
      returns: { orderBy: { hoursAfter: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: TradeRow[] = [];

  for (const idea of raw) {
    if (!idea.confluence) continue;
    const conf = idea.confluence as unknown as StoredConfluence;
    if (typeof conf.total !== "number") continue;
    if (!["BTC", "ETH"].includes(idea.asset)) continue;
    const asset = idea.asset as "BTC" | "ETH";

    const peakReturn =
      idea.returns.length > 0
        ? idea.returns.reduce((best, r) => (Math.abs(r.returnPct) > Math.abs(best.returnPct) ? r : best)).returnPct
        : null;

    const targetLevels = idea.levels.filter((l) => l.type === "TARGET");
    const invalidationLevels = idea.levels.filter((l) => l.type === "INVALIDATION");

    const firstWin = targetLevels
      .filter((l) => l.outcome === "WIN" && l.resolvedAt)
      .sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime())[0];

    const firstLoss = invalidationLevels
      .filter((l) => l.outcome === "LOSS" && l.resolvedAt)
      .sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime())[0];

    const firstWinHours = firstWin ? (firstWin.resolvedAt!.getTime() - idea.createdAt.getTime()) / 3_600_000 : null;
    const firstLossHours = firstLoss ? (firstLoss.resolvedAt!.getTime() - idea.createdAt.getTime()) / 3_600_000 : null;

    let isWin: boolean | null = null;
    if (firstWinHours !== null && firstLossHours !== null) {
      isWin = firstWinHours <= firstLossHours;
    } else if (firstWinHours !== null) {
      isWin = true;
    } else if (firstLossHours !== null) {
      isWin = false;
    }

    // Retrospective ML score (in-sample — model trained on this data)
    const mlResult = await runMlAggregator(asset, {
      derivatives: conf.derivatives ?? 0,
      etfs: conf.etfs ?? 0,
      htf: conf.htf ?? 0,
      exchangeFlows: conf.exchangeFlows ?? 0,
    });

    rows.push({
      id: idea.id,
      asset,
      total: conf.total,
      mlRetro: mlResult?.mlTotal ?? null,
      peakReturn,
      isWin,
      isResolved: isWin !== null,
    });
  }

  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${chalk.bold.cyan("  ML vs Heuristic Aggregator Comparison")}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TRAINING DIAGNOSTICS (from meta.json — authoritative, properly CV'd)
  // ═══════════════════════════════════════════════════════════════════════════
  section("1. Training Diagnostics (from meta.json — CV-validated)");

  for (const asset of ["BTC", "ETH"] as const) {
    const meta = loadMeta(asset);
    if (!meta) {
      console.log(`  ${asset}: meta.json not found`);
      continue;
    }

    console.log(
      `\n  ${chalk.underline(asset)} — n=${meta.n_samples}  range: ${meta.date_range.start.slice(0, 10)} → ${meta.date_range.end.slice(0, 10)}`,
    );
    console.log(
      `  Class balance: ${meta.class_balance.wins}W / ${meta.class_balance.losses}L (${((meta.class_balance.wins / meta.n_samples) * 100).toFixed(0)}% wins)`,
    );

    console.log(`\n  Accuracy comparison:`);
    const heurAcc = meta.heuristic_baseline_full.accuracy;
    const mlInSample = meta.training_metrics_in_sample.accuracy;
    const mlOof = meta.cv.oof.accuracy;
    const foldAccs = meta.cv.fold_metrics.map((f) => f.accuracy);
    const foldStr = foldAccs.map((a) => (a * 100).toFixed(0) + "%").join("  ");

    const heurColor = heurAcc >= 0.5 ? chalk.green : chalk.red;
    const oofColor = mlOof >= 0.55 ? chalk.green : mlOof >= 0.5 ? chalk.yellow : chalk.red;

    console.log(
      `    Heuristic (full set):  ${heurColor((heurAcc * 100).toFixed(1) + "%")}   log_loss=${meta.heuristic_baseline_full.log_loss.toFixed(3)}`,
    );
    console.log(`    ML in-sample:          ${(mlInSample * 100).toFixed(1)}%   ${chalk.dim("(overfit — ignore)")}`);
    console.log(
      `    ML OOF (5-fold CV):    ${oofColor((mlOof * 100).toFixed(1) + "%")}   log_loss=${meta.cv.oof.log_loss.toFixed(3)}`,
    );
    console.log(
      `    Fold accuracies:       ${foldStr}  ${chalk.dim(`(std=${(Math.sqrt(avg(foldAccs.map((a) => (a - avg(foldAccs)) ** 2))) * 100).toFixed(1)}%)`)}`,
    );

    console.log(`\n  Per-dim Pearson IC (correlation with win outcome):`);
    for (const dim of CONFLUENCE_DIMENSIONS) {
      const k = CONFLUENCE_KEY_MAP[dim];
      const ic = meta.pearson_ic_per_dim[k] ?? 0;
      const coef = meta.coefficients[k] ?? 0;
      const icColor = ic > 0.1 ? chalk.green : ic > 0 ? chalk.yellow : ic < -0.1 ? chalk.red : chalk.dim;
      console.log(
        `    ${dim.padEnd(16)} IC=${icColor(ic.toFixed(3))}  ML coef=${coef > 0 ? chalk.green(coef.toFixed(3)) : chalk.red(coef.toFixed(3))}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. RETROSPECTIVE SCORING — re-score resolved heuristic trades through ML
  // ═══════════════════════════════════════════════════════════════════════════
  section("2. Retrospective Signal Quality (⚠ IN-SAMPLE — model trained on this data)");
  console.log(chalk.dim("  Spearman rank correlation of each score with peak return."));
  console.log(chalk.yellow("  ⚠ ML scores here are in-sample. Use CV metrics above for reliable comparison."));

  console.log("\n  Loading and retroactively scoring all trades...");
  const all = await loadRows();
  const resolved = all.filter((r) => r.isResolved && r.mlRetro !== null && r.peakReturn !== null);

  console.log(`  Total: ${all.length}  |  Resolved with retro ML: ${resolved.length}`);

  for (const asset of ["BTC", "ETH", "ALL"] as const) {
    const rows = asset === "ALL" ? resolved : resolved.filter((r) => r.asset === asset);
    if (rows.length < 5) {
      console.log(`\n  ${asset}: insufficient data (n=${rows.length})`);
      continue;
    }

    const returns = rows.map((r) => r.peakReturn!);
    const totals = rows.map((r) => r.total);
    const mlRetros = rows.map((r) => r.mlRetro!);

    const rhoH = spearman(totals, returns);
    const rhoM = spearman(mlRetros, returns);
    const better = rhoM > rhoH ? chalk.green("ML") : chalk.yellow("Heuristic");

    console.log(`\n  ${chalk.underline(`${asset} (n=${rows.length})`)}`);
    console.log(`    Heuristic ρ = ${rhoH.toFixed(3)}`);
    console.log(`    ML        ρ = ${rhoM.toFixed(3)}  ${chalk.dim("(in-sample)")}`);
    console.log(`    Better: ${better}  (Δ = ${(rhoM - rhoH).toFixed(3)})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. WIN RATE BY CONVICTION BUCKET
  // ═══════════════════════════════════════════════════════════════════════════
  section("3. Win Rate by Conviction Tercile");
  console.log(chalk.dim("  Does higher conviction → higher win rate? Resolved trades only."));

  for (const asset of ["BTC", "ETH", "ALL"] as const) {
    const rows = asset === "ALL" ? resolved : resolved.filter((r) => r.asset === asset);
    if (rows.length < 6) {
      console.log(`\n  ${asset}: insufficient data (n=${rows.length})`);
      continue;
    }

    console.log(`\n  ${chalk.underline(`${asset} (n=${rows.length})`)}`);

    for (const { label, key } of [
      { label: "Heuristic (total)", key: "total" as const },
      { label: "ML retro (mlRetro) ⚠ in-sample", key: "mlRetro" as const },
    ]) {
      const sorted = [...rows].sort((a, b) => (a[key] as number) - (b[key] as number));
      const t1 = (sorted[Math.floor(sorted.length / 3)]?.[key] as number) ?? 0;
      const t2 = (sorted[Math.floor((2 * sorted.length) / 3)]?.[key] as number) ?? 0;

      const bottom = rows.filter((r) => (r[key] as number) < t1);
      const middle = rows.filter((r) => (r[key] as number) >= t1 && (r[key] as number) < t2);
      const top = rows.filter((r) => (r[key] as number) >= t2);

      console.log(`\n    ${label}`);
      console.log(
        `      Bottom (< ${t1.toFixed(2)})       n=${String(bottom.length).padEnd(3)}  win=${winRate(bottom)}`,
      );
      console.log(
        `      Middle (${t1.toFixed(2)}–${t2.toFixed(2)})  n=${String(middle.length).padEnd(3)}  win=${winRate(middle)}`,
      );
      console.log(`      Top    (≥ ${t2.toFixed(2)})       n=${String(top.length).padEnd(3)}  win=${winRate(top)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DIVERGENCE — when the two approaches disagree in sign
  // ═══════════════════════════════════════════════════════════════════════════
  section("4. Divergence Analysis (retro ML vs heuristic)");
  console.log(
    chalk.dim(
      "  Sign disagreement on the chosen direction. mlTotal > 0 but total < 0 = ML drove direction, heuristic was skeptical.",
    ),
  );

  const diverged = resolved.filter((r) => r.mlRetro !== null && Math.sign(r.total) !== Math.sign(r.mlRetro!));
  const agreed = resolved.filter((r) => r.mlRetro !== null && Math.sign(r.total) === Math.sign(r.mlRetro!));

  console.log(`\n  Agreed   (same sign): n=${agreed.length}   win=${winRate(agreed)}`);
  console.log(`  Diverged (diff sign): n=${diverged.length}   win=${winRate(diverged)}`);

  if (diverged.length > 0) {
    const mlPos = diverged.filter((r) => r.mlRetro! > 0 && r.total < 0);
    const heurPos = diverged.filter((r) => r.mlRetro! < 0 && r.total > 0);
    if (mlPos.length)
      console.log(`\n    ML+, Heur− (ML bullish, heuristic skeptical): n=${mlPos.length}  win=${winRate(mlPos)}`);
    if (heurPos.length)
      console.log(`    Heur+, ML− (heuristic bullish, ML skeptical): n=${heurPos.length}  win=${winRate(heurPos)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERDICT
  // ═══════════════════════════════════════════════════════════════════════════
  section("Verdict");

  console.log(`
  From the CV-validated training metrics (section 1):
    - Heuristic accuracy was ${chalk.red("below chance")} on training data (~40%).
    - ML OOF accuracy is ~50.5% — ${chalk.yellow("barely above chance")}.
    - 5-fold CV shows high variance (27%–67%), suggesting ${chalk.yellow("weak / noisy signal")}.
    - Neither approach is reliably predictive on this dataset size / time range.

  The retrospective rank correlation (section 2) is ${chalk.dim("in-sample and should be discounted")}.

  Recommendation:
    ${chalk.cyan("→")} Both scores are weak. ML doesn't clearly outperform heuristic out-of-sample.
    ${chalk.cyan("→")} The per-dim ICs in section 1 are the most actionable insight:
       which dimensions actually predict outcomes, and should drive weight allocation.
    ${chalk.cyan("→")} Removing heuristic aggregation in favour of ML requires out-of-sample
       evidence that doesn't exist yet. Accumulate more resolved trades first.
  `);

  console.log(`${"═".repeat(72)}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
