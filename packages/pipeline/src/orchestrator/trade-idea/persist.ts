/**
 * Trade Idea Persistence
 *
 * Saves a structured trade idea with multiple invalidation and target
 * levels linked to its parent brief.
 */

import type { $Enums, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../storage/db.js";
import type { Direction, LevelResult } from "./composite-target.js";
import type { RawFeaturesByDim } from "./extract-features.js";
import type { MlResult, ModelStats } from "./snapshot-ml.js";
import type { PositionSize } from "./sizing.js";

interface SaveTradeIdeaInput {
  briefId: string;
  asset: $Enums.Asset;
  direction: Direction;
  entryPrice: number;
  compositeTarget: number;
  levels: LevelResult[];
  /** Snapshot ML total, or 0 if model unavailable. */
  total: number;
  sizing: PositionSize;
  ml: MlResult | null;
  /** CV stats from the snapshot model meta.json — null when fallback path was used. */
  modelStats: ModelStats | null;
  /** Raw amplitude-encoded features at trade time — training source for models. */
  rawFeatures: RawFeaturesByDim;
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
        total: input.total,
        sizing: {
          positionSizePct: input.sizing.positionSizePct,
          convictionMultiplier: input.sizing.convictionMultiplier,
          dailyVolPct: input.sizing.dailyVolPct,
        },
        aggregator: input.ml
          ? { source: "ml", modelVersion: input.ml.modelVersion, stats: input.modelStats ?? undefined }
          : { source: "fallback" },
        rawFeatures: input.rawFeatures,
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
