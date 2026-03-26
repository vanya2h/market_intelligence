import { get } from "lodash-es";
import { formatUsd, formatPercent, formatNumber, formatCompact } from "./format";

export type MetricSignal = "bullish" | "bearish" | "neutral";

export interface MetricDef {
  label: string;
  value: string;
  group?: string;
  signal?: MetricSignal;
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

function pctSignal(pct: number, highIsBearish = true): MetricSignal {
  if (highIsBearish) return pct > 70 ? "bearish" : pct < 30 ? "bullish" : "neutral";
  return pct > 70 ? "bullish" : pct < 30 ? "bearish" : "neutral";
}

function numSignal(v: number, bullishAbove: number, bearishBelow: number): MetricSignal {
  if (v > bullishAbove) return "bullish";
  if (v < bearishBelow) return "bearish";
  return "neutral";
}

function formatPct(pct: number): string {
  return `${pct}th`;
}

export const DIMENSIONS: Record<string, DimensionDef> = {
  DERIVATIVES: {
    key: "DERIVATIVES",
    label: "Derivatives Structure",
    extractMetrics: (ctx) => {
      const fundingPct = get(ctx, "funding.percentile.1m") as number;
      const oiPct = get(ctx, "openInterest.percentile.1m") as number;
      const liqPct = get(ctx, "liquidations.percentile.1m") as number;
      const cbPct = get(ctx, "coinbasePremium.percentile.1m") as number;
      const ls = get(ctx, "longShortRatio.current") as number;
      const cbRate = get(ctx, "coinbasePremium.current") as number;
      return [
        {
          label: "Funding Rate", group: "Funding",
          value: safe(() => formatPercent((get(ctx, "funding.current") as number) * 100, 4)),
          signal: safe(() => String(fundingPct)) !== "—" ? pctSignal(fundingPct) : undefined,
        },
        {
          label: "Percentile (1m)", group: "Funding",
          value: safe(() => formatPct(fundingPct)),
          signal: safe(() => String(fundingPct)) !== "—" ? pctSignal(fundingPct) : undefined,
        },
        {
          label: "Open Interest", group: "Open Interest",
          value: safe(() => formatUsd(get(ctx, "openInterest.current") as number)),
        },
        {
          label: "OI Signal", group: "Open Interest",
          value: safe(() => get(ctx, "oiSignal") as string),
          signal: safe(() => {
            const s = get(ctx, "oiSignal") as string;
            return s === "EXTREME" || s === "ELEVATED" ? "neutral" : s === "DEPRESSED" ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "Percentile (1m)", group: "Open Interest",
          value: safe(() => formatPct(oiPct)),
          signal: safe(() => String(oiPct)) !== "—" ? pctSignal(oiPct, false) : undefined,
        },
        {
          label: "Long/Short Ratio", group: "Positioning",
          value: safe(() => formatNumber(ls)),
          signal: ls > 2.0 ? "bearish" : ls < 0.8 ? "bullish" : "neutral",
        },
        {
          label: "8h Volume", group: "Liquidations",
          value: safe(() => formatUsd(get(ctx, "liquidations.current8h") as number)),
          signal: safe(() => String(liqPct)) !== "—" ? pctSignal(liqPct) : undefined,
        },
        {
          label: "Bias", group: "Liquidations",
          value: safe(() => get(ctx, "liquidations.bias") as string),
        },
        {
          label: "Percentile (1m)", group: "Liquidations",
          value: safe(() => formatPct(liqPct)),
          signal: safe(() => String(liqPct)) !== "—" ? pctSignal(liqPct) : undefined,
        },
        {
          label: "Rate", group: "Coinbase Premium",
          value: safe(() => formatPercent(cbRate, 3)),
          signal: cbRate > 0 ? "bullish" : cbRate < 0 ? "bearish" : "neutral",
        },
        {
          label: "Percentile (1m)", group: "Coinbase Premium",
          value: safe(() => formatPct(cbPct)),
          signal: safe(() => String(cbPct)) !== "—" ? pctSignal(cbPct, false) : undefined,
        },
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "funding.current") as number) ?? null,
    chartLabel: "Funding Rate",
  },

  ETFS: {
    key: "ETFS",
    label: "Institutional Flows (ETFs)",
    extractMetrics: (ctx) => {
      const today = get(ctx, "flow.today") as number;
      const d3 = get(ctx, "flow.d3Sum") as number;
      const d7 = get(ctx, "flow.d7Sum") as number;
      const d30 = get(ctx, "flow.d30Sum") as number;
      const sigma = get(ctx, "flow.todaySigma") as number;
      return [
        {
          label: "Today", group: "Flows",
          value: safe(() => formatUsd(today)),
          signal: today > 0 ? "bullish" : today < 0 ? "bearish" : "neutral",
        },
        {
          label: "3-Day", group: "Flows",
          value: safe(() => formatUsd(d3)),
          signal: d3 > 0 ? "bullish" : d3 < 0 ? "bearish" : "neutral",
        },
        {
          label: "7-Day", group: "Flows",
          value: safe(() => formatUsd(d7)),
          signal: d7 > 0 ? "bullish" : d7 < 0 ? "bearish" : "neutral",
        },
        {
          label: "30-Day", group: "Flows",
          value: safe(() => formatUsd(d30)),
          signal: d30 > 0 ? "bullish" : d30 < 0 ? "bearish" : "neutral",
        },
        {
          label: "Today Sigma", group: "Flows",
          value: safe(() => formatNumber(sigma)),
          signal: numSignal(sigma, 1, -1),
        },
        { label: "AUM", value: safe(() => "$" + formatCompact(get(ctx, "totalAumUsd") as number)) },
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "flow.today") as number) ?? null,
    chartLabel: "Daily Flow ($)",
  },

  SENTIMENT: {
    key: "SENTIMENT",
    label: "Market Sentiment",
    extractMetrics: (ctx) => {
      const composite = get(ctx, "metrics.compositeIndex") as number;
      const pos = get(ctx, "metrics.components.positioning") as number;
      const trend = get(ctx, "metrics.components.trend") as number;
      const flows = get(ctx, "metrics.components.institutionalFlows") as number;
      const expert = get(ctx, "metrics.components.expertConsensus") as number;
      const zScore = get(ctx, "metrics.zScore") as number;
      const bullishRatio = get(ctx, "metrics.bullishRatio") as number;
      const divergence = get(ctx, "metrics.divergenceType") as string | null;
      return [
        {
          label: "Composite Index", group: "Composite",
          value: safe(() => formatNumber(composite, 1)),
          signal: numSignal(composite, 60, 40),
        },
        {
          label: "Label", group: "Composite",
          value: safe(() => get(ctx, "metrics.compositeLabel") as string),
        },
        {
          label: "Positioning", group: "Components",
          value: safe(() => formatNumber(pos, 0)),
          signal: numSignal(pos, 60, 40),
        },
        {
          label: "Trend", group: "Components",
          value: safe(() => formatNumber(trend, 0)),
          signal: numSignal(trend, 60, 40),
        },
        {
          label: "Inst. Flows", group: "Components",
          value: safe(() => formatNumber(flows, 0)),
          signal: numSignal(flows, 60, 40),
        },
        {
          label: "Expert Consensus", group: "Components",
          value: safe(() => formatNumber(expert, 0)),
          signal: numSignal(expert, 60, 40),
        },
        {
          label: "Z-Score", group: "Expert Consensus",
          value: safe(() => formatNumber(zScore, 2)),
          signal: zScore >= 0.8 ? "bullish" : zScore <= -1.5 ? "bearish" : "neutral",
        },
        {
          label: "Bullish Analysts", group: "Expert Consensus",
          value: safe(() => formatPercent(bullishRatio * 100, 0)),
          signal: numSignal(bullishRatio, 0.6, 0.4),
        },
        ...(divergence ? [{
          label: "Divergence", group: "Expert Consensus",
          value: divergence === "experts_bullish_crowd_fearful" ? "Experts↑ Crowd↓" : "Experts↓ Crowd↑",
          signal: "neutral" as MetricSignal,
        }] : []),
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "metrics.compositeIndex") as number) ?? null,
    chartLabel: "Composite F&G",
  },

  HTF: {
    key: "HTF",
    label: "HTF Technical Structure",
    extractMetrics: (ctx) => {
      const vs50 = get(ctx, "ma.priceVsSma50Pct") as number;
      const vs200 = get(ctx, "ma.priceVsSma200Pct") as number;
      const rsiDaily = get(ctx, "rsi.daily") as number;
      const rsiH4 = get(ctx, "rsi.h4") as number;
      const cross = get(ctx, "ma.crossType") as string;
      const structure = get(ctx, "structure") as string;
      const futDiv = get(ctx, "cvd.futures.divergence") as string;
      const spotDiv = get(ctx, "cvd.spot.divergence") as string;
      return [
        { label: "Price", value: safe(() => formatUsd(get(ctx, "price") as number)) },
        {
          label: "vs SMA 50", group: "Moving Averages",
          value: safe(() => formatPercent(vs50)),
          signal: vs50 > 0 ? "bullish" : "bearish",
        },
        {
          label: "vs SMA 200", group: "Moving Averages",
          value: safe(() => formatPercent(vs200)),
          signal: vs200 > 0 ? "bullish" : "bearish",
        },
        {
          label: "SMA 50", group: "Moving Averages",
          value: safe(() => formatUsd(get(ctx, "ma.sma50") as number)),
        },
        {
          label: "SMA 200", group: "Moving Averages",
          value: safe(() => formatUsd(get(ctx, "ma.sma200") as number)),
        },
        {
          label: "MA Cross", group: "Moving Averages",
          value: safe(() => cross),
          signal: cross === "GOLDEN" ? "bullish" : cross === "DEATH" ? "bearish" : "neutral",
        },
        {
          label: "Daily RSI", group: "Momentum",
          value: safe(() => formatNumber(rsiDaily, 1)),
          signal: rsiDaily > 70 ? "bearish" : rsiDaily < 30 ? "bullish" : "neutral",
        },
        {
          label: "4H RSI", group: "Momentum",
          value: safe(() => formatNumber(rsiH4, 1)),
          signal: rsiH4 > 70 ? "bearish" : rsiH4 < 30 ? "bullish" : "neutral",
        },
        {
          label: "Weekly VWAP", group: "VWAP",
          value: safe(() => formatUsd(get(ctx, "vwap.weekly") as number)),
        },
        {
          label: "Monthly VWAP", group: "VWAP",
          value: safe(() => formatUsd(get(ctx, "vwap.monthly") as number)),
        },
        {
          label: "Futures Short/Long", group: "CVD",
          value: safe(() => `${get(ctx, "cvd.futures.short.regime")} / ${get(ctx, "cvd.futures.long.regime")}`),
        },
        {
          label: "Futures Divergence", group: "CVD",
          value: safe(() => futDiv === "NONE" ? "—" : futDiv),
          signal: futDiv === "BULLISH" ? "bullish" : futDiv === "BEARISH" ? "bearish" : undefined,
        },
        {
          label: "Spot Short/Long", group: "CVD",
          value: safe(() => `${get(ctx, "cvd.spot.short.regime")} / ${get(ctx, "cvd.spot.long.regime")}`),
        },
        {
          label: "Spot Divergence", group: "CVD",
          value: safe(() => spotDiv === "NONE" ? "—" : spotDiv),
          signal: spotDiv === "BULLISH" ? "bullish" : spotDiv === "BEARISH" ? "bearish" : undefined,
        },
        {
          label: "Structure", group: "Structure",
          value: safe(() => structure),
          signal: structure === "HH_HL" ? "bullish" : structure === "LH_LL" ? "bearish" : "neutral",
        },
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "price") as number) ?? null,
    chartLabel: "Price ($)",
  },
};
