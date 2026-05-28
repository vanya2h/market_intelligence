import { CONFLUENCE_DIMENSIONS, DimensionEnum } from "../dimensions.js";

/** Per-dimension confluence scores in -1..+1. Keys are DimensionEnum values. */
export type Confluence = Record<DimensionEnum, number>;

/** Equal-weight arithmetic mean of all confluence dimensions. */
export function getConfluenceTotal(c: Confluence): number {
  return CONFLUENCE_DIMENSIONS.reduce((sum, dim) => sum + c[dim], 0) / CONFLUENCE_DIMENSIONS.length;
}

/**
 * Parse a raw DB JSON blob (JsonValue from Prisma) into a typed Confluence object.
 * Handles both legacy camelCase keys and current DimensionEnum keys.
 * Also extracts the stored ML total (not re-computable from scores alone).
 */
export function parseStoredConfluence(json: unknown): { confluence: Confluence; total: number | null } {
  const raw = (json != null && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    confluence: {
      [DimensionEnum.DERIVATIVES]: Number(raw.DERIVATIVES ?? raw.derivatives ?? 0),
      [DimensionEnum.ETFS]: Number(raw.ETFS ?? raw.etfs ?? 0),
      [DimensionEnum.HTF]: Number(raw.HTF ?? raw.htf ?? 0),
      [DimensionEnum.EXCHANGE_FLOWS]: Number(raw.EXCHANGE_FLOWS ?? raw.exchangeFlows ?? 0),
    },
    total: typeof raw.total === "number" ? raw.total : null,
  };
}
