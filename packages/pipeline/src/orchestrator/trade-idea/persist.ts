/**
 * Trade Idea Persistence
 *
 * Saves a structured trade idea with multiple invalidation and target
 * levels linked to its parent brief.
 */

import type { $Enums, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../storage/db.js";
import type { Direction, LevelResult } from "./composite-target.js";
import type { Confluence } from "./confluence.js";
import type { MlResult } from "./ml-aggregator.js";
import type { PositionSize } from "./sizing.js";

interface SaveTradeIdeaInput {
  briefId: string;
  asset: $Enums.Asset;
  direction: Direction;
  entryPrice: number;
  compositeTarget: number;
  levels: LevelResult[];
  confluence: Confluence;
  sizing: PositionSize;
  ml: MlResult | null;
}

export async function saveTradeIdea(input: SaveTradeIdeaInput): Promise<string> {
  const record = await prisma.tradeIdea.create({
    data: {
      briefId: input.briefId,
      asset: input.asset,
      direction: input.direction,
      entryPrice: input.entryPrice,
      compositeTarget: input.compositeTarget,
      positionSizePct: input.sizing.positionSizePct,
      confluence: {
        ...input.confluence,
        sizing: {
          positionSizePct: input.sizing.positionSizePct,
          convictionMultiplier: input.sizing.convictionMultiplier,
          dailyVolPct: input.sizing.dailyVolPct,
        },
        aggregator: input.ml
          ? { source: "ml", modelVersion: input.ml.modelVersion, pWin: input.ml.pWin }
          : { source: "fallback" },
      } as unknown as Prisma.InputJsonValue,
      levels: {
        create: input.levels.map((l) => ({
          type: l.type,
          label: l.label,
          price: l.price,
        })),
      },
    },
  });
  return record.id;
}
