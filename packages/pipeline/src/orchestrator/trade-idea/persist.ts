/**
 * Trade Idea Persistence
 *
 * Saves a structured trade idea with multiple invalidation and target
 * levels linked to its parent brief.
 */

import { prisma } from "../../storage/db.js";
import type { $Enums, Prisma } from "../../generated/prisma/client.js";
import type { Direction, LevelResult } from "./composite-target.js";
import type { Confluence } from "./confluence.js";
import type { DirectionalBias } from "./bias.js";

interface SaveTradeIdeaInput {
  briefId: string;
  asset: $Enums.Asset;
  direction: Direction;
  entryPrice: number;
  compositeTarget: number;
  levels: LevelResult[];
  confluence: Confluence;
  bias: DirectionalBias;
  skipped: boolean;
}

export async function saveTradeIdea(input: SaveTradeIdeaInput): Promise<string> {
  const record = await prisma.tradeIdea.create({
    data: {
      briefId: input.briefId,
      asset: input.asset,
      direction: input.direction,
      entryPrice: input.entryPrice,
      compositeTarget: input.compositeTarget,
      confluence: {
        ...input.confluence,
        bias: input.bias,
      } as unknown as Prisma.InputJsonValue,
      skipped: input.skipped,
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
