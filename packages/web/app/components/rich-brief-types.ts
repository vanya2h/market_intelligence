/**
 * RichBrief block type definitions.
 *
 * Shared between the React bridge (SSR-safe) and the Arrow.js
 * renderer (client-only). No runtime dependencies.
 */

interface BaseBlock {
  type: string;
}

export interface HeadingBlock extends BaseBlock {
  type: "heading";
  text: string;
  level?: 1 | 2 | 3;
}

export interface TextBlock extends BaseBlock {
  type: "text";
  content: string;
  style?: "default" | "emphasis" | "muted";
}

export interface DividerBlock extends BaseBlock {
  type: "divider";
}

export interface SpacerBlock extends BaseBlock {
  type: "spacer";
}

export interface SpectrumBlock extends BaseBlock {
  type: "spectrum";
  label: string;
  value: number;
  leftLabel: string;
  rightLabel: string;
}

export interface MetricRowBlock extends BaseBlock {
  type: "metric_row";
  items: {
    label: string;
    value: string;
    sentiment?: "bullish" | "bearish" | "neutral";
    detail?: string;
  }[];
}

export interface BarChartBlock extends BaseBlock {
  type: "bar_chart";
  title?: string;
  items: { label: string; value: number; maxValue?: number }[];
}

export interface HeatmapBlock extends BaseBlock {
  type: "heatmap";
  title?: string;
  cells: { label: string; value: number; min?: number; max?: number }[];
}

export interface ScorecardBlock extends BaseBlock {
  type: "scorecard";
  title?: string;
  items: {
    label: string;
    score: number;
    maxScore?: number;
    trend?: "up" | "down" | "flat";
  }[];
}

export interface ComparisonBlock extends BaseBlock {
  type: "comparison";
  title?: string;
  headers?: [string, string];
  rows: { label: string; a: string; b: string }[];
}

export interface CalloutBlock extends BaseBlock {
  type: "callout";
  variant: "bullish" | "bearish" | "warning" | "info";
  title: string;
  content: string;
}

export interface SignalBlock extends BaseBlock {
  type: "signal";
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  label: string;
  detail?: string;
}

export interface LevelMapBlock extends BaseBlock {
  type: "level_map";
  current: number;
  levels: {
    price: number;
    label: string;
    type: "support" | "resistance" | "target" | "stop";
  }[];
}

export interface RegimeBannerBlock extends BaseBlock {
  type: "regime_banner";
  regime: string;
  subtitle?: string;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
}

export interface TensionBlock extends BaseBlock {
  type: "tension";
  title: string;
  left: {
    label: string;
    detail: string;
    sentiment: "bullish" | "bearish" | "neutral";
  };
  right: {
    label: string;
    detail: string;
    sentiment: "bullish" | "bearish" | "neutral";
  };
}

export type RichBlock =
  | HeadingBlock
  | TextBlock
  | DividerBlock
  | SpacerBlock
  | SpectrumBlock
  | MetricRowBlock
  | BarChartBlock
  | HeatmapBlock
  | ScorecardBlock
  | ComparisonBlock
  | CalloutBlock
  | SignalBlock
  | LevelMapBlock
  | RegimeBannerBlock
  | TensionBlock;
