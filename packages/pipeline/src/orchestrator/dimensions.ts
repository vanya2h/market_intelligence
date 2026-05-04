import type { Confluence } from "./trade-idea/confluence.js";

export enum DimensionEnum {
  HTF = "HTF",
  DERIVATIVES = "DERIVATIVES",
  ETFS = "ETFS",
  EXCHANGE_FLOWS = "EXCHANGE_FLOWS",
}

/** All confluence dimensions in display order (HTF first — primary dimension). */
export const CONFLUENCE_DIMENSIONS: DimensionEnum[] = [
  DimensionEnum.HTF,
  DimensionEnum.DERIVATIVES,
  DimensionEnum.ETFS,
  DimensionEnum.EXCHANGE_FLOWS,
];

/** Maps each confluence dimension to its key in the Confluence object. */
export const CONFLUENCE_KEY_MAP: Record<DimensionEnum, Exclude<keyof Confluence, "total">> = {
  [DimensionEnum.HTF]: "htf",
  [DimensionEnum.DERIVATIVES]: "derivatives",
  [DimensionEnum.ETFS]: "etfs",
  [DimensionEnum.EXCHANGE_FLOWS]: "exchangeFlows",
};
