// ─── Orchestrator Types ───────────────────────────────────────────────────────

import type { DerivativesContext } from "../types.js";
import type { EtfContext } from "../etfs/types.js";
import type { SentimentContext } from "../sentiment/types.js";
import type { HtfContext } from "../htf/types.js";

/** Output from a single dimension's pipeline run */
export interface DimensionOutput {
  dimension: string;              // e.g. "derivatives", "etfs", "sentiment", "htf"
  label: string;                  // human-readable, e.g. "Derivatives Structure"
  regime: string;
  context: DerivativesContext | EtfContext | SentimentContext | HtfContext;
  interpretation: string;         // from the dimension's LLM agent
}

/** Full pipeline output for one asset */
export interface AssetBrief {
  asset: "BTC" | "ETH";
  timestamp: string;
  dimensions: DimensionOutput[];
  brief: string;                  // synthesized by orchestrator LLM
}
