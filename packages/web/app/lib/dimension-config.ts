import { formatUsd, formatPercent, formatNumber, formatCompact } from "./format";

export interface MetricDef {
  label: string;
  value: string;
}

type ContextExtractor = (ctx: Record<string, unknown>) => MetricDef[];
type ChartExtractor = (ctx: Record<string, unknown>) => number | null;

interface DimensionDef {
  key: string;
  label: string;
  extractMetrics: ContextExtractor;
  extractChartValue: ChartExtractor;
  chartLabel: string;
}

function safe(fn: () => string, fallback = "—"): string {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function get(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

export const DIMENSIONS: Record<string, DimensionDef> = {
  DERIVATIVES: {
    key: "DERIVATIVES",
    label: "Derivatives Structure",
    extractMetrics: (ctx) => [
      { label: "Funding Rate", value: safe(() => formatPercent(get(ctx, "funding.current") * 100, 4)) },
      { label: "Open Interest", value: safe(() => formatUsd(get(ctx, "openInterest.current"))) },
      { label: "Long/Short Ratio", value: safe(() => formatNumber(get(ctx, "longShortRatio.current"))) },
      { label: "Liquidations (8h)", value: safe(() => formatUsd(get(ctx, "liquidations.current8h"))) },
      { label: "Coinbase Premium", value: safe(() => formatPercent(get(ctx, "coinbasePremium.current"), 3)) },
    ],
    extractChartValue: (ctx) => get(ctx, "funding.current") ?? null,
    chartLabel: "Funding Rate",
  },

  ETFS: {
    key: "ETFS",
    label: "Institutional Flows (ETFs)",
    extractMetrics: (ctx) => [
      { label: "Today", value: safe(() => formatUsd(get(ctx, "flow.today"))) },
      { label: "3-Day", value: safe(() => formatUsd(get(ctx, "flow.d3Sum"))) },
      { label: "7-Day", value: safe(() => formatUsd(get(ctx, "flow.d7Sum"))) },
      { label: "30-Day", value: safe(() => formatUsd(get(ctx, "flow.d30Sum"))) },
      { label: "Today Sigma", value: safe(() => formatNumber(get(ctx, "flow.todaySigma"))) },
      { label: "AUM", value: safe(() => "$" + formatCompact(get(ctx, "totalAumUsd"))) },
    ],
    extractChartValue: (ctx) => get(ctx, "flow.today") ?? null,
    chartLabel: "Daily Flow ($)",
  },

  SENTIMENT: {
    key: "SENTIMENT",
    label: "Market Sentiment",
    extractMetrics: (ctx) => [
      { label: "Composite Index", value: safe(() => formatNumber(get(ctx, "metrics.compositeIndex"), 1)) },
      { label: "Label", value: safe(() => get(ctx, "metrics.compositeLabel")) },
      { label: "Positioning", value: safe(() => formatNumber(get(ctx, "metrics.components.positioning"), 0)) },
      { label: "Trend", value: safe(() => formatNumber(get(ctx, "metrics.components.trend"), 0)) },
      { label: "Inst. Flows", value: safe(() => formatNumber(get(ctx, "metrics.components.institutionalFlows"), 0)) },
      { label: "Expert Consensus", value: safe(() => formatNumber(get(ctx, "metrics.components.expertConsensus"), 0)) },
    ],
    extractChartValue: (ctx) => get(ctx, "metrics.compositeIndex") ?? null,
    chartLabel: "Composite F&G",
  },

  HTF: {
    key: "HTF",
    label: "HTF Technical Structure",
    extractMetrics: (ctx) => [
      { label: "Price", value: safe(() => formatUsd(get(ctx, "price"))) },
      { label: "SMA 50", value: safe(() => formatUsd(get(ctx, "ma.sma50"))) },
      { label: "SMA 200", value: safe(() => formatUsd(get(ctx, "ma.sma200"))) },
      { label: "vs SMA 50", value: safe(() => formatPercent(get(ctx, "ma.priceVsSma50Pct"))) },
      { label: "vs SMA 200", value: safe(() => formatPercent(get(ctx, "ma.priceVsSma200Pct"))) },
      { label: "RSI (Daily)", value: safe(() => formatNumber(get(ctx, "rsi.daily"), 1)) },
      { label: "RSI (4H)", value: safe(() => formatNumber(get(ctx, "rsi.h4"), 1)) },
      { label: "Structure", value: safe(() => get(ctx, "structure")) },
    ],
    extractChartValue: (ctx) => get(ctx, "price") ?? null,
    chartLabel: "Price ($)",
  },
};
