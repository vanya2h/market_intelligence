import { $Enums, Prisma, type RichBlock } from "@market-intel/pipeline";
import { AssetType } from "./asset.js";
import { Jsonify } from "../common/json.js";

export type Regime =
  | $Enums.PositioningRegime
  | $Enums.EtfRegime
  | $Enums.HtfRegime
  | $Enums.SentimentRegime;

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
  dimension: $Enums.Dimension;
  regime: Regime;
  previousRegime: Regime | null;
  since: string; // ISO date
  stress: $Enums.StressLevel | null; // Derivatives only
  oiSignal: $Enums.OiSignal | null; // Derivatives only
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
  momentumDivergence: number | null;
  volatility: number | null;
  timestamp: Date;
  dimensions: BriefDimension[];
};

function sentimentComponent(
  sentiment: Jsonify<BriefRaw>["sentiment"],
  key: string,
): number | null {
  if (!sentiment) return null;
  const ctx = sentiment.context as Record<string, unknown> | null;
  const metrics = ctx?.metrics as Record<string, unknown> | undefined;
  const components = metrics?.components as Record<string, number> | undefined;
  return components?.[key] ?? null;
}

export function parseBrief(raw: Jsonify<BriefRaw>): Brief {
  const dimensions: BriefDimension[] = [];
  if (raw.derivatives) {
    dimensions.push({
      dimension: "DERIVATIVES",
      regime: raw.derivatives.regime,
      previousRegime: raw.derivatives.previousRegime,
      since: raw.derivatives.since as string,
      stress: raw.derivatives.stress,
      oiSignal: raw.derivatives.oiSignal,
      context: raw.derivatives.context as Record<string, unknown>,
      interpretation: raw.derivatives.interpretation,
    });
  }
  if (raw.etfs) {
    dimensions.push({
      dimension: "ETFS",
      regime: raw.etfs.regime,
      previousRegime: raw.etfs.previousRegime,
      since: raw.etfs.since as string,
      stress: null,
      oiSignal: null,
      context: raw.etfs.context as Record<string, unknown>,
      interpretation: raw.etfs.interpretation,
    });
  }
  if (raw.htf) {
    dimensions.push({
      dimension: "HTF",
      regime: raw.htf.regime,
      previousRegime: raw.htf.previousRegime,
      since: raw.htf.since as string,
      stress: null,
      oiSignal: null,
      context: raw.htf.context as Record<string, unknown>,
      interpretation: raw.htf.interpretation,
    });
  }
  if (raw.sentiment) {
    dimensions.push({
      dimension: "SENTIMENT",
      regime: raw.sentiment.regime,
      previousRegime: raw.sentiment.previousRegime,
      since: raw.sentiment.since as string,
      stress: null,
      oiSignal: null,
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
    momentumDivergence: sentimentComponent(raw.sentiment, "momentumDivergence"),
    volatility: sentimentComponent(raw.sentiment, "volatility"),
    timestamp: new Date(raw.timestamp),
    dimensions: dimensions,
  };
}
