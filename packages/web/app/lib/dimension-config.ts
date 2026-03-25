import { get } from "lodash-es";
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

export const DIMENSIONS: Record<string, DimensionDef> = {
  DERIVATIVES: {
    key: "DERIVATIVES",
    label: "Derivatives Structure",
    extractMetrics: (ctx) => [
      { label: "Funding Rate", value: safe(() => formatPercent((get(ctx, "funding.current") as number) * 100, 4)) },
      { label: "Open Interest", value: safe(() => formatUsd(get(ctx, "openInterest.current") as number)) },
      { label: "Long/Short Ratio", value: safe(() => formatNumber(get(ctx, "longShortRatio.current") as number)) },
      { label: "Liquidations (8h)", value: safe(() => formatUsd(get(ctx, "liquidations.current8h") as number)) },
      { label: "Coinbase Premium", value: safe(() => formatPercent(get(ctx, "coinbasePremium.current") as number, 3)) },
    ],
    extractChartValue: (ctx) => (get(ctx, "funding.current") as number) ?? null,
    chartLabel: "Funding Rate",
  },

  ETFS: {
    key: "ETFS",
    label: "Institutional Flows (ETFs)",
    extractMetrics: (ctx) => [
      { label: "Today", value: safe(() => formatUsd(get(ctx, "flow.today") as number)) },
      { label: "3-Day", value: safe(() => formatUsd(get(ctx, "flow.d3Sum") as number)) },
      { label: "7-Day", value: safe(() => formatUsd(get(ctx, "flow.d7Sum") as number)) },
      { label: "30-Day", value: safe(() => formatUsd(get(ctx, "flow.d30Sum") as number)) },
      { label: "Today Sigma", value: safe(() => formatNumber(get(ctx, "flow.todaySigma") as number)) },
      { label: "AUM", value: safe(() => "$" + formatCompact(get(ctx, "totalAumUsd") as number)) },
    ],
    extractChartValue: (ctx) => (get(ctx, "flow.today") as number) ?? null,
    chartLabel: "Daily Flow ($)",
  },

  SENTIMENT: {
    key: "SENTIMENT",
    label: "Market Sentiment",
    extractMetrics: (ctx) => [
      { label: "Composite Index", value: safe(() => formatNumber(get(ctx, "metrics.compositeIndex") as number, 1)) },
      { label: "Label", value: safe(() => get(ctx, "metrics.compositeLabel") as string) },
      { label: "Positioning", value: safe(() => formatNumber(get(ctx, "metrics.components.positioning") as number, 0)) },
      { label: "Trend", value: safe(() => formatNumber(get(ctx, "metrics.components.trend") as number, 0)) },
      { label: "Inst. Flows", value: safe(() => formatNumber(get(ctx, "metrics.components.institutionalFlows") as number, 0)) },
      { label: "Expert Consensus", value: safe(() => formatNumber(get(ctx, "metrics.components.expertConsensus") as number, 0)) },
    ],
    extractChartValue: (ctx) => (get(ctx, "metrics.compositeIndex") as number) ?? null,
    chartLabel: "Composite F&G",
  },

  HTF: {
    key: "HTF",
    label: "HTF Technical Structure",
    extractMetrics: (ctx) => [
      { label: "Price", value: safe(() => formatUsd(get(ctx, "price") as number)) },
      { label: "SMA 50", value: safe(() => formatUsd(get(ctx, "ma.sma50") as number)) },
      { label: "SMA 200", value: safe(() => formatUsd(get(ctx, "ma.sma200") as number)) },
      { label: "vs SMA 50", value: safe(() => formatPercent(get(ctx, "ma.priceVsSma50Pct") as number)) },
      { label: "vs SMA 200", value: safe(() => formatPercent(get(ctx, "ma.priceVsSma200Pct") as number)) },
      { label: "RSI (Daily)", value: safe(() => formatNumber(get(ctx, "rsi.daily") as number, 1)) },
      { label: "RSI (4H)", value: safe(() => formatNumber(get(ctx, "rsi.h4") as number, 1)) },
      { label: "Futures CVD", value: safe(() => formatNumber(get(ctx, "cvd.futures") as number, 0)) },
      { label: "Spot CVD", value: safe(() => formatNumber(get(ctx, "cvd.spot") as number, 0)) },
      { label: "Weekly VWAP", value: safe(() => formatUsd(get(ctx, "vwap.weekly") as number)) },
      { label: "Monthly VWAP", value: safe(() => formatUsd(get(ctx, "vwap.monthly") as number)) },
      { label: "Structure", value: safe(() => get(ctx, "structure") as string) },
    ],
    extractChartValue: (ctx) => (get(ctx, "price") as number) ?? null,
    chartLabel: "Price ($)",
  },
};
