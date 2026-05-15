import type { OhlcvCandle } from "@market-intel/api";
import type { TradeIdeaLevel } from "@market-intel/api";
import type { Time } from "lightweight-charts";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function CandleReturnChart({
  candles,
  levels,
  entryPrice,
  direction,
  createdAt,
}: {
  candles: OhlcvCandle[];
  levels: TradeIdeaLevel[];
  entryPrice: number;
  direction: string;
  createdAt: Date;
}) {
  const candleRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!candleRef.current || !returnRef.current || candles.length === 0) return;

    const green = cssVar("--green") || "#22c55e";
    const red = cssVar("--red") || "#ef4444";
    const muted = cssVar("--text-muted") || "#6b7280";
    const border = cssVar("--border") || "#374151";

    const baseOptions = {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: border, style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    } as const;

    // ── Candle chart ──────────────────────────────────────────────────────────
    const candleChart = createChart(candleRef.current, baseOptions);

    const candleSeries = candleChart.addSeries(CandlestickSeries, {
      upColor: green,
      downColor: red,
      borderUpColor: green,
      borderDownColor: red,
      wickUpColor: green,
      wickDownColor: red,
    });

    candleSeries.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // Entry price line
    candleSeries.createPriceLine({
      price: entryPrice,
      color: muted,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "entry",
    });

    // Target levels
    levels
      .filter((l) => l.type === "TARGET")
      .forEach((l) => {
        candleSeries.createPriceLine({
          price: l.price,
          color: direction === "LONG" ? green : red,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: l.label,
        });
      });

    // Invalidation levels
    levels
      .filter((l) => l.type === "INVALIDATION")
      .forEach((l) => {
        candleSeries.createPriceLine({
          price: l.price,
          color: red,
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: l.label,
        });
      });

    // ── Return chart ──────────────────────────────────────────────────────────
    const returnChart = createChart(returnRef.current, {
      ...baseOptions,
      crosshair: { mode: CrosshairMode.Normal },
    });

    const sign = direction === "SHORT" ? -1 : 1;
    const entryTime = createdAt.getTime();

    const returnData = [
      { time: Math.floor(entryTime / 1000) as Time, value: 0 },
      ...candles.map((c) => ({
        time: Math.floor((c.time + 900_000) / 1000) as Time,
        value: sign * ((c.close - entryPrice) / entryPrice) * 100,
      })),
    ];

    const lastValue = returnData[returnData.length - 1]?.value ?? 0;

    const returnSeries = returnChart.addSeries(LineSeries, {
      color: lastValue >= 0 ? green : red,
      lineWidth: 2,
      priceFormat: {
        type: "custom",
        formatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`,
        minMove: 0.01,
      },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });

    returnSeries.setData(returnData);

    // Zero baseline
    returnSeries.createPriceLine({
      price: 0,
      color: muted,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "",
    });

    // ── Sync time scales ──────────────────────────────────────────────────────
    let syncing = false;
    candleChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      returnChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });
    returnChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      candleChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    candleChart.timeScale().fitContent();

    return () => {
      candleChart.remove();
      returnChart.remove();
    };
  }, [candles, levels, entryPrice, direction, createdAt]);

  if (candles.length === 0) {
    return (
      <div
        className="flex h-48 items-center justify-center text-[0.625rem] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Awaiting price data
      </div>
    );
  }

  return (
    <div>
      {/* Candle pane */}
      <div ref={candleRef} style={{ height: "180px" }} />

      {/* Return pane */}
      <div ref={returnRef} style={{ height: "80px", borderTop: "1px solid var(--border-subtle)", marginTop: "1px" }} />
    </div>
  );
}
