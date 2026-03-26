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

export const DimensionBaseSchema = z.object({
  id: z.string(),
  briefId: z.string(),
  regime: z.string(),
  previousRegime: z.string().nullable(),
  since: z.string(),
  context: z.any(),
  interpretation: z.string(),
});

export const BriefSchema = z.object({
  id: z.string(),
  asset: z.string(),
  timestamp: z.string(),
  brief: z.string(),
  richBrief: z.any().nullable().optional(),
  dimensions: z.array(z.string()),
  derivatives: DimensionBaseSchema.extend({
    stress: z.string().nullable(),
    previousStress: z.string().nullable(),
  }).nullable().optional(),
  etfs: DimensionBaseSchema.nullable().optional(),
  htf: DimensionBaseSchema.extend({
    lastStructure: z.string().nullable(),
    snapshotPrice: z.number().nullable(),
  }).nullable().optional(),
  sentiment: DimensionBaseSchema.extend({
    compositeIndex: z.number().nullable(),
    compositeLabel: z.string().nullable(),
    positioning: z.number().nullable(),
    trend: z.number().nullable(),
    institutionalFlows: z.number().nullable(),
    expertConsensus: z.number().nullable(),
  }).nullable().optional(),
});

export const DimensionStateSchema = z.object({
  id: z.string(),
  asset: z.string(),
  dimension: z.string(),
  regime: z.string(),
  since: z.string(),
  previousRegime: z.string().nullable(),
  lastUpdated: z.string(),
  stress: z.string().nullable().optional(),
  previousStress: z.string().nullable().optional(),
  lastStructure: z.string().nullable().optional(),
});

export const DimensionSnapshotSchema = z.object({
  id: z.string(),
  asset: z.string(),
  dimension: z.string(),
  timestamp: z.string(),
  data: z.any(),
});
