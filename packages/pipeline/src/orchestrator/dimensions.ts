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
