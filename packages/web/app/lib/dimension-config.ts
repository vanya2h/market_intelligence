import { get } from "lodash-es";
import { formatUsd, formatPercent, formatNumber, formatCompact } from "./format";

export type MetricSignal = "bullish" | "bearish" | "neutral";

export interface MetricDef {
  label: string;
  value: string;
  group?: string;
  signal?: MetricSignal;
}

export interface DimensionEvent {
  type: string;
  detail: string;
  at: string;
}

type ContextExtractor = (ctx: Record<string, unknown>) => MetricDef[];
type ChartExtractor = (ctx: Record<string, unknown>) => number | null;
type EventExtractor = (ctx: Record<string, unknown>) => DimensionEvent[];

interface DimensionDef {
  key: string;
  label: string;
  extractMetrics: ContextExtractor;
  extractChartValue: ChartExtractor;
  extractEvents: EventExtractor;
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

function extractEventsFromCtx(ctx: Record<string, unknown>): DimensionEvent[] {
  const raw = get(ctx, "events") as DimensionEvent[] | undefined;
  if (!Array.isArray(raw)) return [];
  return raw;
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
          label: "Funding Rate",
          group: "Funding",
          value: safe(() => formatPercent((get(ctx, "funding.current") as number) * 100, 4)),
          signal: safe(() => String(fundingPct)) !== "—" ? pctSignal(fundingPct) : undefined,
        },
        {
          label: "Percentile (1m)",
          group: "Funding",
          value: safe(() => formatPct(fundingPct)),
          signal: safe(() => String(fundingPct)) !== "—" ? pctSignal(fundingPct) : undefined,
        },
        {
          label: "Open Interest",
          group: "Open Interest",
          value: safe(() => formatUsd(get(ctx, "openInterest.current") as number)),
        },
        {
          label: "OI Signal",
          group: "Open Interest",
          value: safe(() => get(ctx, "oiSignal") as string),
          signal: safe(() => {
            const s = get(ctx, "oiSignal") as string;
            return s === "EXTREME" || s === "ELEVATED" ? "neutral" : s === "DEPRESSED" ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "Percentile (1m)",
          group: "Open Interest",
          value: safe(() => formatPct(oiPct)),
          signal: safe(() => String(oiPct)) !== "—" ? pctSignal(oiPct, false) : undefined,
        },
        {
          label: "OI Δ 24h",
          group: "Open Interest",
          value: safe(() => formatPercent((get(ctx, "signals.oiChange24h") as number) * 100)),
          signal: safe(() => {
            const v = (get(ctx, "signals.oiChange24h") as number) * 100;
            return v > 5 ? "bullish" : v < -5 ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "OI Δ 7d",
          group: "Open Interest",
          value: safe(() => formatPercent((get(ctx, "signals.oiChange7d") as number) * 100)),
          signal: safe(() => {
            const v = (get(ctx, "signals.oiChange7d") as number) * 100;
            return v > 10 ? "bullish" : v < -10 ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "OI Z-Score (30d)",
          group: "Open Interest",
          value: safe(() => formatNumber(get(ctx, "signals.oiZScore30d") as number)),
          signal: safe(() => {
            const z = get(ctx, "signals.oiZScore30d") as number;
            return z > 1.5 ? "bullish" : z < -1.5 ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "Funding Pressure",
          group: "Funding",
          value: safe(() => {
            const cycles = get(ctx, "signals.fundingPressureCycles") as number;
            const side = get(ctx, "signals.fundingPressureSide") as string | null;
            if (!cycles || !side) return "—";
            return `${cycles} cycles (${side})`;
          }),
          signal: safe(() => {
            const cycles = get(ctx, "signals.fundingPressureCycles") as number;
            const side = get(ctx, "signals.fundingPressureSide") as string | null;
            if (!cycles || cycles < 3 || !side) return "neutral";
            return side === "LONG" ? "bearish" : "bullish";
          }) as MetricSignal,
        },
        {
          label: "8h Volume",
          group: "Liquidations",
          value: safe(() => formatUsd(get(ctx, "liquidations.current8h") as number)),
          signal: safe(() => String(liqPct)) !== "—" ? pctSignal(liqPct) : undefined,
        },
        {
          label: "Bias",
          group: "Liquidations",
          value: safe(() => get(ctx, "liquidations.bias") as string),
        },
        {
          label: "Percentile (1m)",
          group: "Liquidations",
          value: safe(() => formatPct(liqPct)),
          signal: safe(() => String(liqPct)) !== "—" ? pctSignal(liqPct) : undefined,
        },
        {
          label: "Rate",
          group: "Coinbase Premium",
          value: safe(() => formatPercent(cbRate, 3)),
          signal: cbRate > 0 ? "bullish" : cbRate < 0 ? "bearish" : "neutral",
        },
        {
          label: "Percentile (1m)",
          group: "Coinbase Premium",
          value: safe(() => formatPct(cbPct)),
          signal: safe(() => String(cbPct)) !== "—" ? pctSignal(cbPct, false) : undefined,
        },
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "funding.current") as number) ?? null,
    extractEvents: extractEventsFromCtx,
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
          label: "Today",
          group: "Flows",
          value: safe(() => formatUsd(today)),
          signal: today > 0 ? "bullish" : today < 0 ? "bearish" : "neutral",
        },
        {
          label: "3-Day",
          group: "Flows",
          value: safe(() => formatUsd(d3)),
          signal: d3 > 0 ? "bullish" : d3 < 0 ? "bearish" : "neutral",
        },
        {
          label: "7-Day",
          group: "Flows",
          value: safe(() => formatUsd(d7)),
          signal: d7 > 0 ? "bullish" : d7 < 0 ? "bearish" : "neutral",
        },
        {
          label: "30-Day",
          group: "Flows",
          value: safe(() => formatUsd(d30)),
          signal: d30 > 0 ? "bullish" : d30 < 0 ? "bearish" : "neutral",
        },
        {
          label: "Today Sigma",
          group: "Flows",
          value: safe(() => formatNumber(sigma)),
          signal: numSignal(sigma, 1, -1),
        },
        {
          label: "Inflow Streak",
          group: "Streaks",
          value: safe(() => {
            const d = get(ctx, "flow.consecutiveInflowDays") as number;
            return d > 0 ? `${d}d` : "—";
          }),
          signal: safe(() => {
            const d = get(ctx, "flow.consecutiveInflowDays") as number;
            return d >= 3 ? "bullish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "Outflow Streak",
          group: "Streaks",
          value: safe(() => {
            const d = get(ctx, "flow.consecutiveOutflowDays") as number;
            return d > 0 ? `${d}d` : "—";
          }),
          signal: safe(() => {
            const d = get(ctx, "flow.consecutiveOutflowDays") as number;
            return d >= 3 ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        {
          label: "Reversal Ratio",
          group: "Streaks",
          value: safe(() => {
            const r = get(ctx, "flow.reversalRatio") as number;
            return r != null ? formatPercent(r * 100) : "—";
          }),
        },
        {
          label: "GBTC Premium",
          group: "GBTC",
          value: safe(() => {
            const r = get(ctx, "gbtcPremiumRate") as number | undefined;
            return r != null ? formatPercent(r) : "—";
          }),
          signal: safe(() => {
            const r = get(ctx, "gbtcPremiumRate") as number | undefined;
            if (r == null) return "neutral";
            return r > 0 ? "bullish" : r < -1 ? "bearish" : "neutral";
          }) as MetricSignal,
        },
        { label: "AUM", value: safe(() => "$" + formatCompact(get(ctx, "totalAumUsd") as number)) },
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "flow.today") as number) ?? null,
    extractEvents: extractEventsFromCtx,
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
      // Expert consensus hidden while collecting delta-based data (re-enable ~2026-04-02)
      return [
        {
          label: "Composite Index",
          group: "Composite",
          value: safe(() => formatNumber(composite, 1)),
          signal: numSignal(composite, 60, 40),
        },
        {
          label: "Label",
          group: "Composite",
          value: safe(() => get(ctx, "metrics.compositeLabel") as string),
        },
        {
          label: "Positioning",
          group: "Components",
          value: safe(() => formatNumber(pos, 0)),
          signal: numSignal(pos, 60, 40),
        },
        {
          label: "Trend",
          group: "Components",
          value: safe(() => formatNumber(trend, 0)),
          signal: numSignal(trend, 60, 40),
        },
        {
          label: "Inst. Flows",
          group: "Components",
          value: safe(() => formatNumber(flows, 0)),
          signal: numSignal(flows, 60, 40),
        },
        {
          label: "Exch. Flows",
          group: "Components",
          value: safe(() => formatNumber(get(ctx, "metrics.components.exchangeFlows") as number, 0)),
          signal: numSignal(get(ctx, "metrics.components.exchangeFlows") as number, 60, 40),
        },
        {
          label: "Mom. Divergence",
          group: "Components",
          value: safe(() => formatNumber(get(ctx, "metrics.components.momentumDivergence") as number, 0)),
          signal: numSignal(get(ctx, "metrics.components.momentumDivergence") as number, 60, 40),
        },
        // {
        //   label: "Consensus Index",
        //   group: "Unbias Consensus",
        //   value: safe(() => formatNumber(get(ctx, "metrics.consensusIndex") as number, 0)),
        //   signal: numSignal(get(ctx, "metrics.consensusIndex") as number, 20, -20),
        // },
        // {
        //   label: "30d MA",
        //   group: "Unbias Consensus",
        //   value: safe(() => formatNumber(get(ctx, "metrics.consensusIndex30dMa") as number, 0)),
        // },
        // {
        //   label: "Z-Score",
        //   group: "Unbias Consensus",
        //   value: safe(() => formatNumber(get(ctx, "metrics.zScore") as number)),
        //   signal: safe(() => {
        //     const z = get(ctx, "metrics.zScore") as number;
        //     return z >= 0.8 ? "bullish" : z <= -1.5 ? "bearish" : "neutral";
        //   }) as MetricSignal,
        // },
        // {
        //   label: "Δ 7d",
        //   group: "Unbias Consensus",
        //   value: safe(() => {
        //     const d = get(ctx, "metrics.consensusDelta7d") as number;
        //     return (d > 0 ? "+" : "") + formatNumber(d, 1);
        //   }),
        //   signal: safe(() => {
        //     const d = get(ctx, "metrics.consensusDelta7d") as number;
        //     return d > 5 ? "bullish" : d < -5 ? "bearish" : "neutral";
        //   }) as MetricSignal,
        // },
        // {
        //   label: "Analysts",
        //   group: "Unbias Consensus",
        //   value: safe(() => {
        //     const total = get(ctx, "metrics.totalAnalysts") as number;
        //     const ratio = get(ctx, "metrics.bullishRatio") as number;
        //     return `${Math.round(ratio * 100)}% bullish (${total})`;
        //   }),
        // },
        ...(get(ctx, "metrics.divergence") === true
          ? [
              {
                label: "Divergence",
                group: "Signals",
                value: safe(() => {
                  const t = get(ctx, "metrics.divergenceType") as string;
                  return t === "experts_bullish_crowd_fearful"
                    ? "Experts bullish / Crowd fearful"
                    : t === "experts_bearish_crowd_greedy"
                      ? "Experts bearish / Crowd greedy"
                      : "Active";
                }),
                signal: "neutral" as MetricSignal,
              },
            ]
          : []),
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "metrics.compositeIndex") as number) ?? null,
    extractEvents: extractEventsFromCtx,
    chartLabel: "Composite F&G",
  },

  EXCHANGE_FLOWS: {
    key: "EXCHANGE_FLOWS",
    label: "Exchange Flows & Liquidity",
    extractMetrics: (ctx) => {
      const netFlow1d = get(ctx, "metrics.netFlow1d") as number;
      const netFlow7d = get(ctx, "metrics.netFlow7d") as number;
      const netFlow30d = get(ctx, "metrics.netFlow30d") as number;
      const totalBalance = get(ctx, "metrics.totalBalance") as number;
      const totalBalanceUsd = get(ctx, "metrics.totalBalanceUsd") as number;
      const reserveChange7dPct = get(ctx, "metrics.reserveChange7dPct") as number;
      const reserveChange30dPct = get(ctx, "metrics.reserveChange30dPct") as number;
      const todaySigma = get(ctx, "metrics.todaySigma") as number;
      const flowPercentile = get(ctx, "metrics.flowPercentile1m") as number;
      const balanceTrend = get(ctx, "metrics.balanceTrend") as string;
      const asset = get(ctx, "asset") as string;

      // For exchange flows: outflow (negative) = bullish, inflow (positive) = bearish
      const flowSignal = (v: number): MetricSignal => (v < 0 ? "bullish" : v > 0 ? "bearish" : "neutral");

      const topExchanges = (get(ctx, "metrics.topExchanges") as { exchange: string; balance: number; changePct7d: number }[]) ?? [];

      return [
        {
          label: "1d Net Flow",
          group: "Flows",
          value: safe(() => `${netFlow1d >= 0 ? "+" : ""}${formatCompact(netFlow1d)} ${asset}`),
          signal: flowSignal(netFlow1d),
        },
        {
          label: "7d Net Flow",
          group: "Flows",
          value: safe(() => `${netFlow7d >= 0 ? "+" : ""}${formatCompact(netFlow7d)} ${asset}`),
          signal: flowSignal(netFlow7d),
        },
        {
          label: "30d Net Flow",
          group: "Flows",
          value: safe(() => `${netFlow30d >= 0 ? "+" : ""}${formatCompact(netFlow30d)} ${asset}`),
          signal: flowSignal(netFlow30d),
        },
        {
          label: "Today Sigma",
          group: "Flows",
          value: safe(() => formatNumber(todaySigma)),
          signal: todaySigma <= -2 ? "bullish" : todaySigma >= 2 ? "bearish" : "neutral",
        },
        {
          label: "Flow Percentile (1m)",
          group: "Flows",
          value: safe(() => `${flowPercentile}th`),
        },
        {
          label: "Total Reserve",
          group: "Reserves",
          value: safe(() => `${formatCompact(totalBalance)} ${asset}`),
        },
        {
          label: "Reserve Value",
          group: "Reserves",
          value: safe(() => formatUsd(totalBalanceUsd)),
        },
        {
          label: "7d Change",
          group: "Reserves",
          value: safe(() => formatPercent(reserveChange7dPct)),
          signal: reserveChange7dPct < 0 ? "bullish" : reserveChange7dPct > 0 ? "bearish" : "neutral",
        },
        {
          label: "30d Change",
          group: "Reserves",
          value: safe(() => formatPercent(reserveChange30dPct)),
          signal: reserveChange30dPct < 0 ? "bullish" : reserveChange30dPct > 0 ? "bearish" : "neutral",
        },
        {
          label: "Trend",
          group: "Reserves",
          value: safe(() => balanceTrend),
          signal: balanceTrend === "FALLING" ? "bullish" : balanceTrend === "RISING" ? "bearish" : "neutral",
        },
        ...(get(ctx, "metrics.isAt30dLow") === true
          ? [{ label: "30d Low", group: "Reserves", value: "Yes — at 30d reserve low", signal: "bullish" as MetricSignal }]
          : []),
        ...(get(ctx, "metrics.isAt30dHigh") === true
          ? [{ label: "30d High", group: "Reserves", value: "Yes — at 30d reserve high", signal: "bearish" as MetricSignal }]
          : []),
        ...topExchanges.slice(0, 5).map((ex) => ({
          label: ex.exchange,
          group: "Top Exchanges",
          value: safe(() => `${formatCompact(ex.balance)} ${asset}`),
          signal: (ex.changePct7d < -1 ? "bullish" : ex.changePct7d > 1 ? "bearish" : "neutral") as MetricSignal,
        })),
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "metrics.netFlow7d") as number) ?? null,
    extractEvents: extractEventsFromCtx,
    chartLabel: "7d Net Flow",
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
          label: "vs SMA 50",
          group: "Moving Averages",
          value: safe(() => formatPercent(vs50)),
          signal: vs50 > 0 ? "bullish" : "bearish",
        },
        {
          label: "vs SMA 200",
          group: "Moving Averages",
          value: safe(() => formatPercent(vs200)),
          signal: vs200 > 0 ? "bullish" : "bearish",
        },
        {
          label: "SMA 50",
          group: "Moving Averages",
          value: safe(() => formatUsd(get(ctx, "ma.sma50") as number)),
        },
        {
          label: "SMA 200",
          group: "Moving Averages",
          value: safe(() => formatUsd(get(ctx, "ma.sma200") as number)),
        },
        {
          label: "MA Cross",
          group: "Moving Averages",
          value: safe(() => cross),
          signal: cross === "GOLDEN" ? "bullish" : cross === "DEATH" ? "bearish" : "neutral",
        },
        {
          label: "Daily RSI",
          group: "Momentum",
          value: safe(() => formatNumber(rsiDaily, 1)),
          signal: rsiDaily > 70 ? "bearish" : rsiDaily < 30 ? "bullish" : "neutral",
        },
        {
          label: "4H RSI",
          group: "Momentum",
          value: safe(() => formatNumber(rsiH4, 1)),
          signal: rsiH4 > 70 ? "bearish" : rsiH4 < 30 ? "bullish" : "neutral",
        },
        {
          label: "Weekly VWAP",
          group: "VWAP",
          value: safe(() => formatUsd(get(ctx, "vwap.weekly") as number)),
        },
        {
          label: "Monthly VWAP",
          group: "VWAP",
          value: safe(() => formatUsd(get(ctx, "vwap.monthly") as number)),
        },
        {
          label: "Futures Short/Long",
          group: "CVD",
          value: safe(() => `${get(ctx, "cvd.futures.short.regime")} / ${get(ctx, "cvd.futures.long.regime")}`),
        },
        {
          label: "Futures Divergence",
          group: "CVD",
          value: safe(() => (futDiv === "NONE" ? "—" : futDiv)),
          signal: futDiv === "BULLISH" ? "bullish" : futDiv === "BEARISH" ? "bearish" : undefined,
        },
        {
          label: "Spot Short/Long",
          group: "CVD",
          value: safe(() => `${get(ctx, "cvd.spot.short.regime")} / ${get(ctx, "cvd.spot.long.regime")}`),
        },
        {
          label: "Spot Divergence",
          group: "CVD",
          value: safe(() => (spotDiv === "NONE" ? "—" : spotDiv)),
          signal: spotDiv === "BULLISH" ? "bullish" : spotDiv === "BEARISH" ? "bearish" : undefined,
        },
        {
          label: "Structure",
          group: "Structure",
          value: safe(() => structure),
          signal: structure === "HH_HL" ? "bullish" : structure === "LH_LL" ? "bearish" : "neutral",
        },
        {
          label: "ATR (4h)",
          group: "Volatility",
          value: safe(() => formatUsd(get(ctx, "atr") as number)),
        },
        ...(get(ctx, "volumeProfile.profile.poc") != null
          ? [
              {
                label: "POC",
                group: "Volume Profile",
                value: safe(() => formatUsd(get(ctx, "volumeProfile.profile.poc") as number)),
              },
              {
                label: "VA High",
                group: "Volume Profile",
                value: safe(() => formatUsd(get(ctx, "volumeProfile.profile.vaHigh") as number)),
              },
              {
                label: "VA Low",
                group: "Volume Profile",
                value: safe(() => formatUsd(get(ctx, "volumeProfile.profile.vaLow") as number)),
              },
              {
                label: "Price Position",
                group: "Volume Profile",
                value: safe(() => (get(ctx, "volumeProfile.profile.pricePosition") as string).replace(/_/g, " ")),
                signal: (() => {
                  const pos = get(ctx, "volumeProfile.profile.pricePosition") as string;
                  if (pos === "BELOW_VA") return "bullish" as MetricSignal;
                  if (pos === "ABOVE_VA") return "bearish" as MetricSignal;
                  return "neutral" as MetricSignal;
                })(),
              },
              {
                label: "Price vs POC",
                group: "Volume Profile",
                value: safe(() => formatPercent(get(ctx, "volumeProfile.profile.priceVsPocPct") as number)),
                signal: (() => {
                  const pct = get(ctx, "volumeProfile.profile.priceVsPocPct") as number;
                  if (pct < -3) return "bullish" as MetricSignal;
                  if (pct > 3) return "bearish" as MetricSignal;
                  return "neutral" as MetricSignal;
                })(),
              },
              {
                label: "POC Volume",
                group: "Volume Profile",
                value: safe(() => `${formatNumber(get(ctx, "volumeProfile.profile.pocVolumePct") as number, 1)}%`),
              },
              {
                label: "Range",
                group: "Volume Profile",
                value: safe(() => {
                  const candles = get(ctx, "volumeProfile.rangeStartCandles") as number;
                  return `${candles} candles (~${formatNumber(candles * 4 / 24, 0)}d)`;
                }),
              },
            ]
          : []),
        ...(get(ctx, "ma.recentCross") !== "NONE" && get(ctx, "ma.recentCross") != null
          ? [
              {
                label: "Recent Cross",
                group: "Moving Averages",
                value: safe(() => get(ctx, "ma.recentCross") as string),
                signal: ((get(ctx, "ma.recentCross") as string) === "GOLDEN" ? "bullish" : "bearish") as MetricSignal,
              },
            ]
          : []),
        ...(get(ctx, "staleness.rsiExtreme") != null
          ? [
              {
                label: "RSI Extreme Age",
                group: "Signal Freshness",
                value: safe(() => `${get(ctx, "staleness.rsiExtreme")} candles ago`),
              },
            ]
          : []),
        ...(get(ctx, "staleness.cvdDivergencePeak") != null
          ? [
              {
                label: "CVD Div. Peak Age",
                group: "Signal Freshness",
                value: safe(() => `${get(ctx, "staleness.cvdDivergencePeak")} candles ago`),
              },
            ]
          : []),
        ...(get(ctx, "staleness.lastPivot") != null
          ? [
              {
                label: "Last Pivot Age",
                group: "Signal Freshness",
                value: safe(() => `${get(ctx, "staleness.lastPivot")} candles ago`),
              },
            ]
          : []),
      ];
    },
    extractChartValue: (ctx) => (get(ctx, "price") as number) ?? null,
    extractEvents: extractEventsFromCtx,
    chartLabel: "Price ($)",
  },
};
