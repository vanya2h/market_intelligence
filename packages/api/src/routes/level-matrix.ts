/**
 * Level Matrix — API route
 *
 * For every (target, stop) label combination, simulates trade outcomes across
 * all historical trade ideas using actual price series from trade_idea_returns.
 *
 * GET /level-matrix/:asset?horizon=168
 */

import { Prisma, prisma } from "@market-intel/pipeline";
import { describeRoute, validator } from "hono-openapi";
import { z } from "zod";
import { createController } from "../common/controller.js";
import { AssetParamSchema } from "../common/schemas.js";

// ─── Response types ───────────────────────────────────────────────────────────

export interface MatrixCellData {
  n: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  ev: number;
  rr: number;
}

export interface LevelMatrixResponse {
  asset: string;
  horizon: number;
  totalIdeas: number;
  skippedNoReturns: number;
  skippedNoLevels: number;
  stopLabels: string[];
  targetLabels: string[];
  cells: Record<string, Record<string, MatrixCellData>>;
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface LevelRow {
  tradeIdeaId: string;
  type: "INVALIDATION" | "TARGET";
  label: string;
  price: number;
}

interface ReturnRow {
  tradeIdeaId: string;
  hoursAfter: bigint;
  price: number;
  returnPct: number;
}

// ─── Simulation cell ──────────────────────────────────────────────────────────

interface Cell {
  winPnl: number[];
  lossPnl: number[];
  openPnl: number[];
}

function computeCell(c: Cell): MatrixCellData {
  const wins = c.winPnl.length;
  const losses = c.lossPnl.length;
  const open = c.openPnl.length;
  const n = wins + losses + open;
  const resolved = wins + losses;

  const winRate = resolved > 0 ? wins / resolved : 0;
  const avgWin = wins > 0 ? c.winPnl.reduce((a, b) => a + b, 0) / wins : 0;
  const avgLoss = losses > 0 ? c.lossPnl.reduce((a, b) => a + b, 0) / losses : 0;

  const allPnl = [...c.winPnl, ...c.lossPnl, ...c.openPnl];
  const ev = allPnl.length > 0 ? allPnl.reduce((a, b) => a + b, 0) / allPnl.length : 0;
  const rr = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;

  return { n, wins, losses, open, winRate, avgWin, avgLoss, ev, rr };
}

// ─── Route ────────────────────────────────────────────────────────────────────

const HorizonQuerySchema = z.object({
  horizon: z.coerce.number().int().min(1).max(8760).default(168),
});

const levelMatrixRoute = describeRoute({
  summary: "Get level return matrix",
  description: "Simulates trade outcomes for all (target, stop) combos using historical price series",
  tags: ["Trade Ideas"],
  responses: { 200: { description: "Level matrix data" } },
});

export const LevelMatrixController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get(
        "/level-matrix/:asset",
        levelMatrixRoute,
        validator("param", AssetParamSchema),
        validator("query", HorizonQuerySchema),
        async (c) => {
          const { asset } = c.req.valid("param");
          const { horizon } = c.req.valid("query");

          // 1. Load ideas
          const ideas = await prisma.tradeIdea.findMany({
            where: { asset, direction: { in: ["LONG", "SHORT"] } },
            orderBy: { createdAt: "asc" },
            select: { id: true, direction: true, entryPrice: true },
          });

          const ids = ideas.map((i) => i.id);
          if (ids.length === 0) {
            const empty: LevelMatrixResponse = {
              asset,
              horizon,
              totalIdeas: 0,
              skippedNoReturns: 0,
              skippedNoLevels: 0,
              stopLabels: [],
              targetLabels: [],
              cells: {},
            };
            return c.json(empty);
          }

          // 2. Load levels
          const levelRows = await prisma.$queryRaw<LevelRow[]>(
            Prisma.sql`
              SELECT "tradeIdeaId", type, label, price
              FROM trade_idea_levels
              WHERE "tradeIdeaId" IN (${Prisma.join(ids)})
            `,
          );

          // 3. Load returns up to horizon
          const returnRows = await prisma.$queryRaw<ReturnRow[]>(
            Prisma.sql`
              SELECT "tradeIdeaId", "hoursAfter", price, "returnPct"
              FROM trade_idea_returns
              WHERE "tradeIdeaId" IN (${Prisma.join(ids)})
                AND "hoursAfter" <= ${horizon}
              ORDER BY "tradeIdeaId", "hoursAfter"
            `,
          );

          // Index by idea
          const levelsByIdea = new Map<string, LevelRow[]>();
          for (const l of levelRows) {
            const arr = levelsByIdea.get(l.tradeIdeaId) ?? [];
            arr.push(l);
            levelsByIdea.set(l.tradeIdeaId, arr);
          }

          const returnsByIdea = new Map<string, { hoursAfter: number; price: number; returnPct: number }[]>();
          for (const r of returnRows) {
            const row = { hoursAfter: Number(r.hoursAfter), price: r.price, returnPct: r.returnPct };
            const arr = returnsByIdea.get(r.tradeIdeaId) ?? [];
            arr.push(row);
            returnsByIdea.set(r.tradeIdeaId, arr);
          }

          // 4. Collect unique labels
          const allTargetLabels = new Set<string>();
          const allStopLabels = new Set<string>();
          for (const l of levelRows) {
            if (l.type === "TARGET") allTargetLabels.add(l.label);
            else allStopLabels.add(l.label);
          }

          const stopOrder = ["S1", "S2", "S3", "S4", "1:2", "1:3", "1:4", "1:5"];
          const targetOrder = ["T1", "T2", "T3"];
          const stopLabels = stopOrder.filter((l) => allStopLabels.has(l));
          const targetLabels = targetOrder.filter((l) => allTargetLabels.has(l));

          // 5. Simulate
          const rawCells = new Map<string, Map<string, Cell>>();
          for (const s of stopLabels) {
            const row = new Map<string, Cell>();
            for (const t of targetLabels) row.set(t, { winPnl: [], lossPnl: [], openPnl: [] });
            rawCells.set(s, row);
          }

          let skippedNoLevels = 0;
          let skippedNoReturns = 0;

          for (const idea of ideas) {
            const levels = levelsByIdea.get(idea.id);
            const returns = returnsByIdea.get(idea.id);

            if (!levels || levels.length === 0) {
              skippedNoLevels++;
              continue;
            }
            if (!returns || returns.length === 0) {
              skippedNoReturns++;
              continue;
            }

            const dirSign = idea.direction === "LONG" ? 1 : -1;
            const entry = idea.entryPrice;
            const lastReturn = returns[returns.length - 1]!;

            const targets: [string, number][] = levels
              .filter((l) => l.type === "TARGET")
              .map((l) => [l.label, l.price]);
            const stops: [string, number][] = levels
              .filter((l) => l.type === "INVALIDATION")
              .map((l) => [l.label, l.price]);

            for (const [stopLabel, stopPrice] of stops) {
              const stopMap = rawCells.get(stopLabel);
              if (!stopMap) continue;

              for (const [targetLabel, targetPrice] of targets) {
                const cell = stopMap.get(targetLabel);
                if (!cell) continue;

                let outcome: "win" | "loss" | "open" = "open";
                let pnl = lastReturn.returnPct * dirSign;

                for (const ret of returns) {
                  const price = ret.price;
                  const targetHit = idea.direction === "LONG" ? price >= targetPrice : price <= targetPrice;
                  const stopHit = idea.direction === "LONG" ? price <= stopPrice : price >= stopPrice;

                  if (targetHit) {
                    outcome = "win";
                    pnl = ((targetPrice - entry) / entry) * 100 * dirSign;
                    break;
                  }
                  if (stopHit) {
                    outcome = "loss";
                    pnl = ((stopPrice - entry) / entry) * 100 * dirSign;
                    break;
                  }
                }

                if (outcome === "win") cell.winPnl.push(pnl);
                else if (outcome === "loss") cell.lossPnl.push(pnl);
                else cell.openPnl.push(pnl);
              }
            }
          }

          // 6. Build response
          const cells: Record<string, Record<string, MatrixCellData>> = {};
          for (const s of stopLabels) {
            cells[s] = {};
            for (const t of targetLabels) {
              const raw = rawCells.get(s)?.get(t);
              if (raw) cells[s]![t] = computeCell(raw);
            }
          }

          const result: LevelMatrixResponse = {
            asset,
            horizon,
            totalIdeas: ideas.length,
            skippedNoReturns,
            skippedNoLevels,
            stopLabels,
            targetLabels,
            cells,
          };
          return c.json(result);
        },
      ),
});
