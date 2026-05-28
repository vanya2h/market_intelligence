/**
 * Level Return Matrix
 *
 * For every (target, stop) label combination, simulates trade outcomes across
 * all historical trade ideas using actual price series from trade_idea_returns.
 *
 * Simulation rule (closing-price):
 *   - Scan returns sorted by hoursAfter up to --horizon (default 168h).
 *   - LONG:  target hit if close >= target_price; stop hit if close <= stop_price.
 *   - SHORT: target hit if close <= target_price; stop hit if close >= stop_price.
 *   - First hit wins. If neither: use last close returnPct as realized P&L.
 *
 * P&L is expressed as % of entry (positive = profit regardless of direction).
 *
 * Usage:
 *   tsx src/scripts/level-matrix.ts               # BTC, 168h
 *   tsx src/scripts/level-matrix.ts --asset ETH
 *   tsx src/scripts/level-matrix.ts --horizon 336
 *   tsx src/scripts/level-matrix.ts --min-conviction 0.2
 */

import "../env.js";
import chalk from "chalk";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../storage/db.js";
import { parseAsset } from "./utils.js";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArg(flag: string, defaultVal: number, parse: (s: string) => number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return defaultVal;
  const val = parse(process.argv[idx + 1] ?? "");
  if (Number.isNaN(val)) throw new Error(`${flag} requires a number`);
  return val;
}

const horizon = parseArg("--horizon", 168, (s) => parseInt(s, 10));
const minConviction = parseArg("--min-conviction", 0, parseFloat);

// ─── DB types ─────────────────────────────────────────────────────────────────

interface IdeaRow {
  id: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  confluenceTotal: number | null;
  confluence: Record<string, unknown> | null;
}

interface LevelRow {
  tradeIdeaId: string;
  type: "INVALIDATION" | "TARGET";
  label: string;
  price: number;
}

interface ReturnRow {
  tradeIdeaId: string;
  hoursAfter: number;
  price: number;
  returnPct: number;
}

// ─── Matrix cell ──────────────────────────────────────────────────────────────

interface Cell {
  n: number;
  wins: number;
  losses: number;
  open: number;
  winPnl: number[]; // P&L % per winning trade
  lossPnl: number[]; // P&L % per losing trade (negative)
  openPnl: number[]; // P&L % for open trades (unrealized at horizon)
}

function emptyCell(): Cell {
  return { n: 0, wins: 0, losses: 0, open: 0, winPnl: [], lossPnl: [], openPnl: [] };
}

function cellStats(c: Cell): {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  ev: number;
  rr: number;
} {
  const totalPnl = [...c.winPnl, ...c.lossPnl, ...c.openPnl];
  if (totalPnl.length === 0) return { winRate: 0, avgWin: 0, avgLoss: 0, ev: 0, rr: 0 };

  const resolved = c.wins + c.losses;
  const winRate = resolved > 0 ? c.wins / resolved : 0;
  const avgWin = c.winPnl.length > 0 ? c.winPnl.reduce((a, b) => a + b, 0) / c.winPnl.length : 0;
  const avgLoss = c.lossPnl.length > 0 ? c.lossPnl.reduce((a, b) => a + b, 0) / c.lossPnl.length : 0;
  const ev = totalPnl.reduce((a, b) => a + b, 0) / totalPnl.length;
  const rr = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : Infinity;
  return { winRate, avgWin, avgLoss, ev, rr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(v: number): string {
  return v >= 0 ? "+" : "";
}

function col(v: number, decimals: number, threshold: number): string {
  const s = `${sign(v)}${v.toFixed(decimals)}`;
  if (v >= threshold) return chalk.green(s);
  if (v > 0) return chalk.dim(s);
  return chalk.red(s);
}

function printTable(
  matrix: Map<string, Map<string, Cell>>,
  stopLabels: string[],
  targetLabels: string[],
  metric: "ev" | "winRate" | "rr",
): void {
  const header = ["Stop \\ Target", ...targetLabels].map((h) => h.padEnd(12)).join("  ");
  console.log(chalk.bold(`\n  ${header}`));
  console.log(chalk.dim(`  ${"─".repeat(header.length)}`));

  for (const stop of stopLabels) {
    const stopMap = matrix.get(stop);
    const cells = targetLabels.map((t) => {
      const cell = stopMap?.get(t);
      if (!cell || cell.n < 2) return chalk.dim("  —         ");
      const stats = cellStats(cell);
      let val: number;
      let fmt: string;
      if (metric === "ev") {
        val = stats.ev;
        fmt = `${sign(val)}${val.toFixed(2)}%`;
      } else if (metric === "winRate") {
        val = stats.winRate * 100 - 50; // center at 50% for coloring
        fmt = `${(stats.winRate * 100).toFixed(0)}% (n=${cell.n})`;
      } else {
        val = stats.rr - 1; // center at 1.0
        fmt = `${stats.rr.toFixed(2)}:1`;
      }
      const colored = col(val, 2, metric === "winRate" ? 5 : metric === "rr" ? 0.5 : 0.2);
      return `  ${colored.padEnd(14)}`;
    });
    console.log(`  ${stop.padEnd(12)}  ${cells.join("  ")}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  console.log(
    `\nLevel Return Matrix — ${chalk.bold(asset)}   horizon=${chalk.bold(`${horizon}h`)}   min-conviction=${chalk.bold((minConviction * 100).toFixed(0) + "%")}\n`,
  );

  // 1. Load ideas
  const ideas = await prisma.tradeIdea.findMany({
    where: { asset, direction: { in: ["LONG", "SHORT"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, direction: true, entryPrice: true, confluence: true },
  });

  // Filter by conviction if requested
  const filtered = ideas.filter((idea) => {
    if (minConviction <= 0) return true;
    const conf = idea.confluence as Record<string, unknown> | null;
    const total = conf ? (typeof conf.total === "number" ? Math.abs(conf.total) : 0) : 0;
    return total >= minConviction;
  }) as IdeaRow[];

  if (filtered.length === 0) {
    console.log(chalk.yellow("  No trade ideas found."));
    return;
  }
  console.log(`  Trade ideas: ${filtered.length}`);

  const ids = filtered.map((i) => i.id);

  // 2. Load levels for all ideas
  const levelRows = await prisma.$queryRaw<LevelRow[]>(
    Prisma.sql`
      SELECT "tradeIdeaId", type, label, price
      FROM trade_idea_levels
      WHERE "tradeIdeaId" IN (${Prisma.join(ids)})
    `,
  );

  // 3. Load return series (up to horizon) for all ideas
  const returnRows = await prisma.$queryRaw<(ReturnRow & { hoursAfter: bigint })[]>(
    Prisma.sql`
      SELECT "tradeIdeaId", "hoursAfter", price, "returnPct"
      FROM trade_idea_returns
      WHERE "tradeIdeaId" IN (${Prisma.join(ids)})
        AND "hoursAfter" <= ${horizon}
      ORDER BY "tradeIdeaId", "hoursAfter"
    `,
  );

  // Index by tradeIdeaId
  const levelsByIdea = new Map<string, LevelRow[]>();
  for (const l of levelRows) {
    const arr = levelsByIdea.get(l.tradeIdeaId) ?? [];
    arr.push(l);
    levelsByIdea.set(l.tradeIdeaId, arr);
  }

  const returnsByIdea = new Map<string, ReturnRow[]>();
  for (const r of returnRows) {
    const row: ReturnRow = { ...r, hoursAfter: Number(r.hoursAfter) };
    const arr = returnsByIdea.get(r.tradeIdeaId) ?? [];
    arr.push(row);
    returnsByIdea.set(r.tradeIdeaId, arr);
  }

  // 4. Build the matrix
  // Collect all unique target/stop labels
  const allTargetLabels = new Set<string>();
  const allStopLabels = new Set<string>();
  for (const l of levelRows) {
    if (l.type === "TARGET") allTargetLabels.add(l.label);
    else allStopLabels.add(l.label);
  }

  // Sort labels: S1→S4, then 1:2→1:5; T1→T3
  const stopOrder = ["S1", "S2", "S3", "S4", "1:2", "1:3", "1:4", "1:5"];
  const targetOrder = ["T1", "T2", "T3"];
  const stopLabels = stopOrder.filter((l) => allStopLabels.has(l));
  const targetLabels = targetOrder.filter((l) => allTargetLabels.has(l));

  // matrix[stopLabel][targetLabel] → Cell
  const matrix = new Map<string, Map<string, Cell>>();
  for (const s of stopLabels) {
    const row = new Map<string, Cell>();
    for (const t of targetLabels) row.set(t, emptyCell());
    matrix.set(s, row);
  }

  let noReturns = 0;
  let noLevels = 0;

  for (const idea of filtered) {
    const levels = levelsByIdea.get(idea.id);
    const returns = returnsByIdea.get(idea.id);

    if (!levels || levels.length === 0) { noLevels++; continue; }
    if (!returns || returns.length === 0) { noReturns++; continue; }

    const dirSign = idea.direction === "LONG" ? 1 : -1;
    const entry = idea.entryPrice;

    const targets = new Map<string, number>(levels.filter((l) => l.type === "TARGET").map((l) => [l.label, l.price]));
    const stops = new Map<string, number>(levels.filter((l) => l.type === "INVALIDATION").map((l) => [l.label, l.price]));

    const lastReturn = returns[returns.length - 1]!;

    for (const [stopLabel, stopPrice] of stops) {
      const stopMap = matrix.get(stopLabel);
      if (!stopMap) continue;

      for (const [targetLabel, targetPrice] of targets) {
        const cell = stopMap.get(targetLabel);
        if (!cell) continue;

        cell.n++;

        // Scan price series for first hit
        let outcome: "win" | "loss" | "open" = "open";
        let resolutionPnlPct = lastReturn.returnPct * dirSign; // fallback

        for (const ret of returns) {
          const price = ret.price;
          const targetHit =
            idea.direction === "LONG" ? price >= targetPrice : price <= targetPrice;
          const stopHit =
            idea.direction === "LONG" ? price <= stopPrice : price >= stopPrice;

          if (targetHit) {
            outcome = "win";
            resolutionPnlPct = ((targetPrice - entry) / entry) * 100 * dirSign;
            break;
          }
          if (stopHit) {
            outcome = "loss";
            resolutionPnlPct = ((stopPrice - entry) / entry) * 100 * dirSign;
            break;
          }
        }

        if (outcome === "win") {
          cell.wins++;
          cell.winPnl.push(resolutionPnlPct);
        } else if (outcome === "loss") {
          cell.losses++;
          cell.lossPnl.push(resolutionPnlPct);
        } else {
          cell.open++;
          cell.openPnl.push(resolutionPnlPct);
        }
      }
    }
  }

  if (noLevels > 0) console.log(chalk.dim(`  ${noLevels} ideas skipped — no levels stored`));
  if (noReturns > 0) console.log(chalk.dim(`  ${noReturns} ideas skipped — no return data`));

  // 5. Print
  console.log(chalk.bold("\n  ── Expected Value (avg P&L % including open) ──"));
  printTable(matrix, stopLabels, targetLabels, "ev");

  console.log(chalk.bold("\n  ── Win Rate (target hit before stop, resolved only) ──"));
  printTable(matrix, stopLabels, targetLabels, "winRate");

  console.log(chalk.bold("\n  ── Risk:Reward (avg win / avg loss, resolved only) ──"));
  printTable(matrix, stopLabels, targetLabels, "rr");

  // Detailed stats for each combo
  console.log(chalk.bold("\n  ── Detailed breakdown ──\n"));
  console.log(
    chalk.dim(
      `  ${"Combo".padEnd(10)} ${"N".padEnd(5)} ${"Wins".padEnd(7)} ${"Losses".padEnd(8)} ${"Open".padEnd(7)} ${"Win%".padEnd(8)} ${"AvgWin".padEnd(9)} ${"AvgLoss".padEnd(10)} EV`,
    ),
  );
  console.log(chalk.dim(`  ${"─".repeat(80)}`));

  for (const stop of stopLabels) {
    for (const target of targetLabels) {
      const cell = matrix.get(stop)?.get(target);
      if (!cell || cell.n === 0) continue;
      const s = cellStats(cell);
      const combo = `${target}×${stop}`;
      const resolved = cell.wins + cell.losses;
      const winPct = resolved > 0 ? (cell.wins / resolved) * 100 : 0;

      console.log(
        `  ${combo.padEnd(10)} ${String(cell.n).padEnd(5)} ${String(cell.wins).padEnd(7)} ${String(cell.losses).padEnd(8)} ${String(cell.open).padEnd(7)} ${(winPct.toFixed(0) + "%").padEnd(8)} ${(sign(s.avgWin) + s.avgWin.toFixed(2) + "%").padEnd(9)} ${(sign(s.avgLoss) + s.avgLoss.toFixed(2) + "%").padEnd(10)} ${col(s.ev, 2, 0.2)}%`,
      );
    }
  }

  console.log();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
