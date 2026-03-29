/**
 * Shared dimension constants — single source of truth for ordering,
 * DB keys, confluence keys, and labels across the entire web app.
 */

/** Dimension DB keys in display order (HTF first — primary dimension) */
export const DIMENSIONS = ["HTF", "DERIVATIVES", "ETFS", "EXCHANGE_FLOWS", "SENTIMENT"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Confluence object keys (lowercase, matching the Confluence interface) */
export const CONFLUENCE_KEYS = ["htf", "derivatives", "etfs", "exchangeFlows", "sentiment"] as const;
export type ConfluenceKey = (typeof CONFLUENCE_KEYS)[number];

/** Maps DB dimension key → confluence object key */
export const CONFLUENCE_KEY_MAP: Record<Dimension, ConfluenceKey> = {
  HTF: "htf",
  DERIVATIVES: "derivatives",
  ETFS: "etfs",
  EXCHANGE_FLOWS: "exchangeFlows",
  SENTIMENT: "sentiment",
};

/** Full display labels */
export const DIMENSION_LABELS: Record<Dimension, string> = {
  HTF: "HTF Structure",
  DERIVATIVES: "Derivatives",
  ETFS: "ETFs",
  EXCHANGE_FLOWS: "Exchange Flows",
  SENTIMENT: "Sentiment",
};

/** Short labels for compact UI (badges, mobile) */
export const DIMENSION_SHORT_LABELS: Record<ConfluenceKey, string> = {
  htf: "HTF",
  derivatives: "Deriv",
  etfs: "ETFs",
  exchangeFlows: "ExFlow",
  sentiment: "Sent",
};
