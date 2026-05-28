/**
 * ML Backtest — re-infers per-dim + L1 scores from stored rawFeatures, then
 * measures the direction call against actual forward price move.
 *
 * For each TradeIdea with rawFeatures, the current ONNX models are re-run and
 * the direction (sign of re-inferred mlTotal) is compared to the raw price
 * return at a configurable horizon. Answers: "If we had deployed the current
 * model on every historical snapshot, what would the strategy return have been?"
 *
 * Usage:
 *   tsx src/scripts/backtest-ml.ts                     # BTC, 168h horizon
 *   tsx src/scripts/backtest-ml.ts --asset ETH
 *   tsx src/scripts/backtest-ml.ts --horizon 24
 *   tsx src/scripts/backtest-ml.ts --min-conviction 0.2
 */

import chalk from "chalk";
import { Prisma } from "../generated/prisma/client.js";
import { DimensionEnum } from "../orchestrator/dimensions.js";
import { type Confluence, getConfluenceTotal, parseStoredConfluence } from "../orchestrator/trade-idea/confluence.js";
import type { RawFeaturesByDim } from "../orchestrator/trade-idea/extract-features.js";
import { runIntradimMl } from "../orchestrator/trade-idea/intradim-ml.js";
import { runMlAggregator } from "../orchestrator/trade-idea/ml-aggregator.js";
import { prisma } from "../storage/db.js";
import { parseAsset } from "./utils.js";
import "../env.js";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseHorizon(): number {
  const idx = process.argv.indexOf("--horizon");
  if (idx === -1) return 168;
  const val = parseInt(process.argv[idx + 1] ?? "", 10);
  if (Number.isNaN(val) || val <= 0)
    throw new Error(`--horizon requires a positive integer, got: "${process.argv[idx + 1]}"`);
  return val;
}

function parseMinConviction(): number {
  const idx = process.argv.indexOf("--min-conviction");
  if (idx === -1) return 0;
  const val = parseFloat(process.argv[idx + 1] ?? "");
  if (Number.isNaN(val) || val < 0 || val > 1)
    throw new Error(`--min-conviction must be in [0, 1], got: "${process.argv[idx + 1]}"`);
  return val;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReturnRow {
  tradeIdeaId: string;
  hoursAfter: bigint; // Prisma returns INTEGER as bigint in $queryRaw
  returnPct: number;
}

interface BacktestRow {
  date: Date;
  mlTotal: number;
  heuristicTotal: number | null;
  returnPct: number;
  hoursAfter: number;
  // Binary 1x strategy return (direction only, no sizing)
  strategyReturn: number;
  win: boolean;
  // Conviction-weighted return: mlTotal * returnPct
  // Positive = model and market agreed and were sized accordingly
  sizedReturn: number;
  heuristicSizedReturn: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract amplitude-encoded rawFeatures from the stored confluence JSON blob.
 * Returns null if any of the 4 dim feature sets are missing or empty.
 */
function extractStoredFeatures(confluenceJson: unknown): RawFeaturesByDim | null {
  if (confluenceJson == null || typeof confluenceJson !== "object") return null;
  const conf = confluenceJson as Record<string, unknown>;
  const rf = conf["rawFeatures"];
  if (rf == null || typeof rf !== "object" || Array.isArray(rf)) return null;
  const rfObj = rf as Record<string, unknown>;

  function dimFeatures(key: string): Record<string, number> | null {
    const d = rfObj[key];
    if (d == null || typeof d !== "object" || Array.isArray(d)) return null;
    if (Object.keys(d).length === 0) return null;
    return d as Record<string, number>;
  }

  const DERIVATIVES = dimFeatures("DERIVATIVES");
  const ETFS = dimFeatures("ETFS");
  const HTF = dimFeatures("HTF");
  const EXCHANGE_FLOWS = dimFeatures("EXCHANGE_FLOWS");

  if (!DERIVATIVES || !ETFS || !HTF || !EXCHANGE_FLOWS) return null;
  return { DERIVATIVES, ETFS, HTF, EXCHANGE_FLOWS };
}

function computeStats(values: number[]): { mean: number; std: number; sharpe: number } {
  if (values.length === 0) return { mean: 0, std: 0, sharpe: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std, sharpe: std === 0 ? 0 : mean / std };
}

function colorPct(v: number, d = 1): string {
  const s = `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
  if (v >= 1) return chalk.green.bold(s);
  if (v > 0) return chalk.green(s);
  if (v <= -1) return chalk.red.bold(s);
  return chalk.red(s);
}

function colorScore(v: number): string {
  const s = `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
  if (v >= 0.5) return chalk.green.bold(s);
  if (v > 0) return chalk.green(s);
  if (v <= -0.5) return chalk.red.bold(s);
  return chalk.red(s);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  const horizon = parseHorizon();
  const minConviction = parseMinConviction();

  console.log(
    `\n🔬 ML Backtest — ${chalk.bold(asset)}   horizon=${chalk.bold(`${horizon}h`)}   min-conviction=${chalk.bold((minConviction * 100).toFixed(0) + "%")}\n`,
  );

  // 1. Load all LONG/SHORT TradeIdeas for the asset
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset, direction: { in: ["LONG", "SHORT"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, confluence: true },
  });

  // 2. Filter to rows that have complete rawFeatures for all 4 dims
  const withFeatures = ideas
    .map((idea) => ({ ...idea, rawFeatures: extractStoredFeatures(idea.confluence) }))
    .filter((idea): idea is typeof idea & { rawFeatures: RawFeaturesByDim } => idea.rawFeatures !== null);

  console.log(`  Total TradeIdeas : ${ideas.length}`);
  console.log(`  With rawFeatures : ${withFeatures.length}`);

  if (withFeatures.length === 0) {
    console.log(chalk.yellow("\n  No rows have rawFeatures. Run: pnpm ml:backfill-features"));
    return;
  }

  // 3. Bulk-fetch the closest return row to the target horizon for each idea
  const ids = withFeatures.map((i) => i.id);
  const returnRows = await prisma.$queryRaw<ReturnRow[]>(
    Prisma.sql`
      SELECT DISTINCT ON ("tradeIdeaId")
        "tradeIdeaId",
        "hoursAfter",
        "returnPct"
      FROM trade_idea_returns
      WHERE "tradeIdeaId" IN (${Prisma.join(ids)})
      ORDER BY "tradeIdeaId", ABS("hoursAfter" - ${horizon})
    `,
  );
  const returnMap = new Map(returnRows.map((r) => [r.tradeIdeaId, r]));

  console.log(`  With ≈${horizon}h returns: ${returnMap.size}`);

  if (returnMap.size === 0) {
    console.log(chalk.yellow("\n  No return data found. trade_idea_returns table may be empty."));
    return;
  }

  // 4. Re-run ONNX inference for each idea that has a return row
  console.log("\n  Re-running ONNX inference...");
  const results: BacktestRow[] = [];
  let skipped = 0;

  for (const idea of withFeatures) {
    const ret = returnMap.get(idea.id);
    if (!ret) continue;

    let mlTotal: number;
    try {
      const intradim = await runIntradimMl(asset, idea.rawFeatures);
      const confluence: Confluence = {
        [DimensionEnum.DERIVATIVES]: intradim[DimensionEnum.DERIVATIVES].score,
        [DimensionEnum.ETFS]: intradim[DimensionEnum.ETFS].score,
        [DimensionEnum.HTF]: intradim[DimensionEnum.HTF].score,
        [DimensionEnum.EXCHANGE_FLOWS]: intradim[DimensionEnum.EXCHANGE_FLOWS].score,
      };
      const ml = await runMlAggregator(asset, confluence);
      mlTotal = ml?.mlTotal ?? getConfluenceTotal(confluence);
    } catch {
      skipped++;
      continue;
    }

    // heuristicTotal is the IC-weighted score stored at the time of the brief
    const { total: heuristicTotal } = parseStoredConfluence(idea.confluence);

    // Binary 1x: direction only
    const strategyReturn = mlTotal >= 0 ? ret.returnPct : -ret.returnPct;
    // Conviction-weighted: model score × actual return (positive = sized correctly)
    const sizedReturn = mlTotal * ret.returnPct;
    const heuristicSizedReturn = heuristicTotal != null ? heuristicTotal * ret.returnPct : null;

    results.push({
      date: idea.createdAt,
      mlTotal,
      heuristicTotal,
      returnPct: ret.returnPct,
      hoursAfter: Number(ret.hoursAfter),
      strategyReturn,
      win: strategyReturn > 0,
      sizedReturn,
      heuristicSizedReturn,
    });
  }

  if (skipped > 0) console.log(chalk.yellow(`  ${skipped} rows skipped (ONNX inference error)`));

  // 5. Apply min-conviction filter
  const filtered = minConviction > 0 ? results.filter((r) => Math.abs(r.mlTotal) >= minConviction) : results;

  if (filtered.length === 0) {
    console.log(chalk.yellow("\n  No rows remaining after conviction filter. Try a lower --min-conviction."));
    return;
  }

  const dateFirst = filtered[0]!.date.toISOString().slice(0, 10);
  const dateLast = filtered[filtered.length - 1]!.date.toISOString().slice(0, 10);
  console.log(`\n  Evaluated : ${chalk.bold(String(filtered.length))} trades`);
  console.log(`  Date range: ${dateFirst} → ${dateLast}\n`);

  // ─── Trade Log ──────────────────────────────────────────────────────────────

  console.log(chalk.bold("═══ TRADE LOG ════════════════════════════════════════════════════════════\n"));
  console.log(chalk.dim(`  ${"Date".padEnd(12)} Dir    mlTotal  Heuristic  ±@${horizon}h   Sized ret`));
  console.log(chalk.dim(`  ${"─".repeat(70)}`));

  for (const r of filtered) {
    const date = r.date.toISOString().slice(0, 10);
    const dir = r.mlTotal >= 0 ? chalk.green("LONG ") : chalk.red("SHORT");
    console.log(
      `  ${date}  ${dir}  ${colorScore(r.mlTotal)}   ${r.heuristicTotal != null ? colorScore(r.heuristicTotal) : chalk.dim(" —     ")}   ${colorPct(r.returnPct)}   ${colorPct(r.sizedReturn)}`,
    );
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(chalk.bold("\n═══ SUMMARY ══════════════════════════════════════════════════════════════\n"));

  const sign = (v: number) => (v >= 0 ? "+" : "");

  // Primary metric: conviction-weighted return (sized by |mlTotal|)
  const mlSized = filtered.map((r) => r.sizedReturn);
  const { mean: mlMean, sharpe: mlSharpe } = computeStats(mlSized);
  const mlCum = mlSized.reduce((a, b) => a + b, 0);

  // Secondary: binary win rate (direction only, unweighted)
  const mlWins = filtered.filter((r) => r.win).length;
  const mlWinRate = mlWins / filtered.length;

  const heurRows = filtered.filter(
    (r): r is BacktestRow & { heuristicTotal: number; heuristicSizedReturn: number } =>
      r.heuristicTotal != null && r.heuristicSizedReturn != null,
  );

  if (heurRows.length > 0) {
    const heurSized = heurRows.map((r) => r.heuristicSizedReturn);
    const heurBinary = heurRows.map((r) => (r.heuristicTotal >= 0 ? r.returnPct : -r.returnPct));
    const heurWins = heurBinary.filter((v) => v > 0).length;
    const heurWinRate = heurWins / heurRows.length;
    const { mean: heurMean, sharpe: heurSharpe } = computeStats(heurSized);
    const winDelta = (mlWinRate - heurWinRate) * 100;
    const winDeltaStr =
      winDelta >= 0 ? chalk.green(`+${winDelta.toFixed(1)}pp`) : chalk.red(`${winDelta.toFixed(1)}pp`);

    console.log(
      `  Avg sized ret  ML: ${chalk.bold(sign(mlMean) + mlMean.toFixed(3) + "%")}   Heuristic: ${sign(heurMean) + heurMean.toFixed(3)}%`,
    );
    console.log(`  Sharpe (sized) ML: ${chalk.bold(mlSharpe.toFixed(2))}   Heuristic: ${heurSharpe.toFixed(2)}`);
    console.log(
      `  Win rate (1x)  ML: ${chalk.bold((mlWinRate * 100).toFixed(1) + "%")}   Heuristic: ${(heurWinRate * 100).toFixed(1)}%   Δ: ${winDeltaStr}`,
    );
  } else {
    console.log(`  Avg sized ret  ML: ${chalk.bold(sign(mlMean) + mlMean.toFixed(3) + "%")}`);
    console.log(`  Sharpe (sized) ML: ${chalk.bold(mlSharpe.toFixed(2))}`);
    console.log(`  Win rate (1x)  ML: ${chalk.bold((mlWinRate * 100).toFixed(1) + "%")}`);
  }
  console.log(`  Cumulative     ML: ${chalk.bold(`${mlCum >= 0 ? "+" : ""}${mlCum.toFixed(2)}%`)}`);

  // Conviction buckets — sized return per bucket shows whether high conviction adds value
  const BUCKETS = [
    { label: "|score| < 0.2 ", min: 0, max: 0.2 },
    { label: "|score| 0.2–0.5", min: 0.2, max: 0.5 },
    { label: "|score| ≥ 0.5  ", min: 0.5, max: Infinity },
  ] as const;

  console.log(chalk.dim("\n  Conviction buckets (sized return):\n"));
  console.log(
    chalk.dim(`  ${"Range".padEnd(18)} ${"N".padEnd(6)} ${"Win%".padEnd(8)} ${"AvgSized".padEnd(12)} Sharpe`),
  );

  for (const b of BUCKETS) {
    const bucket = filtered.filter((r) => Math.abs(r.mlTotal) >= b.min && Math.abs(r.mlTotal) < b.max);
    if (bucket.length === 0) continue;
    const bWins = bucket.filter((r) => r.win).length;
    const { mean: bMean, sharpe: bSharpe } = computeStats(bucket.map((r) => r.sizedReturn));
    const winPct = ((bWins / bucket.length) * 100).toFixed(1);
    const avgRet = `${bMean >= 0 ? "+" : ""}${bMean.toFixed(3)}%`;
    console.log(
      `  ${b.label.padEnd(18)} ${String(bucket.length).padEnd(6)} ${(winPct + "%").padEnd(8)} ${avgRet.padEnd(12)} ${bSharpe.toFixed(2)}`,
    );
  }

  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
