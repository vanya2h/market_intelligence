import { DimensionEnum } from "@market-intel/pipeline";

/** Full display labels */
export const DIMENSION_LABELS: Record<DimensionEnum, string> = {
  [DimensionEnum.HTF]: "HTF Structure",
  [DimensionEnum.DERIVATIVES]: "Derivatives",
  [DimensionEnum.ETFS]: "ETFs",
  [DimensionEnum.EXCHANGE_FLOWS]: "Exchange Flows",
};

/** Short labels for compact UI (badges, mobile) */
export const DIMENSION_SHORT_LABELS: Record<DimensionEnum, string> = {
  [DimensionEnum.HTF]: "HTF",
  [DimensionEnum.DERIVATIVES]: "Deriv",
  [DimensionEnum.ETFS]: "ETFs",
  [DimensionEnum.EXCHANGE_FLOWS]: "ExFlow",
};
