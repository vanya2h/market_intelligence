/**
 * Orchestrator — Brief Persistence
 *
 * Saves a completed brief with all dimension outputs to the database.
 */

import { prisma } from "../storage/db.js";
import type { $Enums, Prisma } from "../generated/prisma/client.js";
import type { DimensionOutput } from "./types.js";
import type { RichBrief } from "./rich-synthesizer.js";

export async function saveBrief(
  asset: $Enums.Asset,
  brief: string,
  outputs: DimensionOutput[],
  richBrief?: RichBrief | null,
): Promise<string> {
  const derivOut = outputs.find((o) => o.dimension === "DERIVATIVES");
  const etfOut = outputs.find((o) => o.dimension === "ETFS");
  const htfOut = outputs.find((o) => o.dimension === "HTF");
  const sentOut = outputs.find((o) => o.dimension === "SENTIMENT");
  const efOut = outputs.find((o) => o.dimension === "EXCHANGE_FLOWS");

  const record = await prisma.brief.create({
    data: {
      asset,
      brief,
      richBrief: richBrief ? JSON.parse(JSON.stringify(richBrief)) : undefined,
      dimensions: outputs.map((o) => o.dimension),
      derivatives: derivOut
        ? {
            create: {
              regime: derivOut.regime,
              stress: derivOut.stress,
              previousRegime: derivOut.previousRegime,
              previousStress: derivOut.previousStress,
              oiSignal: derivOut.oiSignal,
              since: new Date(derivOut.since),
              context: JSON.parse(JSON.stringify(derivOut.context)) as Prisma.InputJsonValue,
              interpretation: derivOut.interpretation,
            },
          }
        : undefined,
      etfs: etfOut
        ? {
            create: {
              regime: etfOut.regime,
              previousRegime: etfOut.previousRegime,
              since: new Date(etfOut.since),
              context: JSON.parse(JSON.stringify(etfOut.context)) as Prisma.InputJsonValue,
              interpretation: etfOut.interpretation,
            },
          }
        : undefined,
      htf: htfOut
        ? {
            create: {
              regime: htfOut.regime,
              previousRegime: htfOut.previousRegime,
              since: new Date(htfOut.since),
              lastStructure: htfOut.lastStructure,
              snapshotPrice: htfOut.snapshotPrice,
              context: JSON.parse(JSON.stringify(htfOut.context)) as Prisma.InputJsonValue,
              interpretation: htfOut.interpretation,
            },
          }
        : undefined,
      sentiment: sentOut
        ? {
            create: {
              regime: sentOut.regime,
              previousRegime: sentOut.previousRegime,
              since: new Date(sentOut.since),
              compositeIndex: sentOut.compositeIndex,
              compositeLabel: sentOut.compositeLabel,
              positioning: sentOut.positioning,
              trend: sentOut.trend,
              institutionalFlows: sentOut.institutionalFlows,
              exchangeFlows: sentOut.exchangeFlows,
              expertConsensus: sentOut.expertConsensus,
              context: JSON.parse(JSON.stringify(sentOut.context)) as Prisma.InputJsonValue,
              interpretation: sentOut.interpretation,
            },
          }
        : undefined,
      exchangeFlows: efOut
        ? {
            create: {
              regime: efOut.regime,
              previousRegime: efOut.previousRegime,
              since: new Date(efOut.since),
              context: JSON.parse(JSON.stringify(efOut.context)) as Prisma.InputJsonValue,
              interpretation: efOut.interpretation,
            },
          }
        : undefined,
    },
  });
  return record.id;
}
