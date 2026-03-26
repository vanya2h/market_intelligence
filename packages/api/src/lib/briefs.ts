import { Prisma, type RichBlock } from "@market-intel/pipeline";
import { AssetType } from "./asset.js";
import { Jsonify } from "../common/json.js";

export const briefInclude = {
  derivatives: true,
  etfs: true,
  htf: true,
  sentiment: true,
} as const satisfies Prisma.BriefInclude;

export type BriefRaw = Prisma.BriefGetPayload<{
  include: typeof briefInclude;
}>;

export type BriefRich = {
  blocks: RichBlock[];
};

export type BriefDimension = {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
};

export type Brief = {
  id: string;
  asset: AssetType;
  brief: string;
  richBrief: BriefRich | null;
  snapshotPrice: number | null;
  compositeIndex: number | null;
  compositeLabel: string | null;
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
  timestamp: Date;
  dimensions: BriefDimension[];
};

export function parseBrief(raw: Jsonify<BriefRaw>): Brief {
  const dimensions: BriefDimension[] = [];
  if (raw.derivatives) {
    dimensions.push({
      dimension: "DERIVATIVES",
      regime: raw.derivatives.regime,
      context: raw.derivatives.context as Record<string, unknown>,
      interpretation: raw.derivatives.interpretation,
    });
  }
  if (raw.etfs) {
    dimensions.push({
      dimension: "ETFS",
      regime: raw.etfs.regime,
      context: raw.etfs.context as Record<string, unknown>,
      interpretation: raw.etfs.interpretation,
    });
  }
  if (raw.htf) {
    dimensions.push({
      dimension: "HTF",
      regime: raw.htf.regime,
      context: raw.htf.context as Record<string, unknown>,
      interpretation: raw.htf.interpretation,
    });
  }
  if (raw.sentiment) {
    dimensions.push({
      dimension: "SENTIMENT",
      regime: raw.sentiment.regime,
      context: raw.sentiment.context as Record<string, unknown>,
      interpretation: raw.sentiment.interpretation,
    });
  }

  return {
    id: raw.id,
    asset: raw.asset as AssetType,
    brief: raw.brief,
    richBrief: raw.richBrief as BriefRich | null,
    snapshotPrice: raw.htf?.snapshotPrice ?? null,
    compositeIndex: raw.sentiment?.compositeIndex ?? null,
    compositeLabel: raw.sentiment?.compositeLabel ?? null,
    positioning: raw.sentiment?.positioning ?? null,
    trend: raw.sentiment?.trend ?? null,
    institutionalFlows: raw.sentiment?.institutionalFlows ?? null,
    expertConsensus: raw.sentiment?.expertConsensus ?? null,
    timestamp: new Date(raw.timestamp),
    dimensions: dimensions,
  };
}
