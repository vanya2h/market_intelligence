import { z } from "zod";

export const AssetParamSchema = z.object({
  asset: z.enum(["BTC", "ETH", "btc", "eth"]).transform((v) => v.toUpperCase() as "BTC" | "ETH"),
});

export const DimensionParamSchema = z.object({
  asset: z.enum(["BTC", "ETH", "btc", "eth"]).transform((v) => v.toUpperCase() as "BTC" | "ETH"),
  dimension: z
    .enum(["DERIVATIVES", "ETFS", "HTF", "SENTIMENT", "derivatives", "etfs", "htf", "sentiment"])
    .transform((v) => v.toUpperCase() as "DERIVATIVES" | "ETFS" | "HTF" | "SENTIMENT"),
});

export const PaginationQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(30),
});

export const BriefDimensionSchema = z.object({
  id: z.string(),
  briefId: z.string(),
  dimension: z.string(),
  label: z.string(),
  regime: z.string(),
  context: z.any(),
  interpretation: z.string(),
});

export const BriefSchema = z.object({
  id: z.string(),
  asset: z.string(),
  timestamp: z.string(),
  brief: z.string(),
  compositeIndex: z.number().nullable(),
  compositeLabel: z.string().nullable(),
  positioning: z.number().nullable(),
  trend: z.number().nullable(),
  institutionalFlows: z.number().nullable(),
  expertConsensus: z.number().nullable(),
  dimensions: z.array(BriefDimensionSchema),
});

export const DimensionStateSchema = z.object({
  id: z.string(),
  asset: z.string(),
  dimension: z.string(),
  regime: z.string(),
  since: z.string(),
  previousRegime: z.string().nullable(),
  lastUpdated: z.string(),
  metadata: z.any().nullable(),
});

export const DimensionSnapshotSchema = z.object({
  id: z.string(),
  asset: z.string(),
  dimension: z.string(),
  timestamp: z.string(),
  data: z.any(),
});
