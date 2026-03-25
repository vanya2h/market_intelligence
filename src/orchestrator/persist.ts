/**
 * Orchestrator — Brief Persistence
 *
 * Saves a completed brief with all dimension outputs to the database.
 */

import { prisma } from "../storage/db.js";
import type { SentimentContext } from "../sentiment/types.js";
import type { DimensionOutput } from "./types.js";

export async function saveBrief(
  asset: "BTC" | "ETH",
  brief: string,
  outputs: DimensionOutput[]
): Promise<void> {
  // Extract sentiment metrics if the sentiment dimension ran
  const sentiment = outputs.find((o) => o.dimension === "sentiment");
  const metrics = (sentiment?.context as SentimentContext | undefined)?.metrics;

  await prisma.brief.create({
    data: {
      asset,
      brief,
      compositeIndex: metrics?.compositeIndex,
      compositeLabel: metrics?.compositeLabel,
      positioning: metrics?.components.positioning,
      trend: metrics?.components.trend,
      institutionalFlows: metrics?.components.institutionalFlows,
      expertConsensus: metrics?.components.expertConsensus,
      dimensions: {
        create: outputs.map((o) => ({
          dimension: o.dimension.toUpperCase() as "DERIVATIVES" | "ETFS" | "HTF" | "SENTIMENT",
          label: o.label,
          regime: o.regime,
          context: o.context as any,
          interpretation: o.interpretation,
        })),
      },
    },
  });
}
