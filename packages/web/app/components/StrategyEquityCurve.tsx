import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, LineStyle, ColorType, CrosshairMode } from "lightweight-charts";
import type { Time } from "lightweight-charts";
import type { StrategyCurvesData, Strategy } from "@market-intel/api";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ─── Tab grid (3 × 3) ────────────────────────────────────────────────────────

const TARGETS = ["T1", "T2", "T3"] as const;
const STOPS = ["S1", "S2", "S3"] as const;

function TabGrid({
  strategies,
  selected,
  onSelect,
}: {
  strategies: Strategy[];
  selected: string;
  onSelect: (label: string) => void;
}) {
  const byLabel = new Map(strategies.map((s) => [s.label, s]));

  return (
    <div className="flex flex-col gap-0.5">
      {/* Column headers */}
      <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-0.5">
        <div />
        {STOPS.map((s) => (
          <div
            key={s}
            className="text-center text-[0.5rem] uppercase tracking-wider py-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            {s}
          </div>
        ))}
      </div>

      {/* Rows */}
      {TARGETS.map((t) => (
        <div key={t} className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-0.5 items-center">
          {/* Row header */}
          <div
            className="text-[0.5rem] uppercase tracking-wider text-right pr-1"
            style={{ color: "var(--text-muted)" }}
          >
            {t}
          </div>

          {STOPS.map((s) => {
            const label = `${t}:${s}`;
            const strat = byLabel.get(label);
            const active = label === selected;
            const ret = strat?.totalReturn ?? 0;
            const color = ret >= 0 ? "var(--green)" : "var(--red)";
            const hasData = (strat?.totalIdeas ?? 0) > 0;

            return (
              <button
                key={label}
                onClick={() => onSelect(label)}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded text-[0.5rem] transition-colors"
                style={{
                  background: active ? "var(--bg-hover)" : "transparent",
                  border: active ? "1px solid var(--border)" : "1px solid var(--border-subtle)",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <span
                  className="font-mono-jb tabular-nums font-medium"
                  style={{ color: hasData ? color : "var(--text-muted)" }}
                >
                  {ret >= 0 ? "+" : ""}
                  {ret.toFixed(1)}%
                </span>
                {strat && (
                  <span className="tabular-nums" style={{ color: "var(--text-muted)", fontSize: "0.4375rem" }}>
                    {strat.winRate !== null ? `${(strat.winRate * 100).toFixed(0)}% WR` : "—"}
                    {" · n="}
                    {strat.totalIdeas}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Returns curve chart ──────────────────────────────────────────────────────

function ReturnsCurve({ strategy }: { strategy: Strategy }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const green = cssVar("--green") || "#22c55e";
    const red = cssVar("--red") || "#ef4444";
    const muted = cssVar("--text-muted") || "#6b7280";
    const border = cssVar("--border") || "#374151";

    const chart = createChart(chartRef.current, {
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
    });

    const lastValue = strategy.points.length > 0 ? strategy.points[strategy.points.length - 1]!.cumulativeReturn : 0;

    const series = chart.addSeries(LineSeries, {
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

    // Zero baseline
    series.createPriceLine({
      price: 0,
      color: muted,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "",
    });

    if (strategy.points.length > 0) {
      // Collapse same-second timestamps — lightweight-charts requires strictly ascending time
      const bySecond = new Map<number, number>();
      for (const p of strategy.points) {
        const t = Math.floor(new Date(p.resolvedAt).getTime() / 1000);
        bySecond.set(t, p.cumulativeReturn);
      }
      series.setData(
        Array.from(bySecond.entries())
          .sort(([a], [b]) => a - b)
          .map(([t, value]) => ({ time: t as Time, value })),
      );
    }

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [strategy]);

  return <div ref={chartRef} style={{ height: "300px" }} />;
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StrategyStats({ strategy }: { strategy: Strategy }) {
  const color = strategy.totalReturn >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="flex items-center gap-6 flex-wrap">
      <div>
        <span className="text-[0.5rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
          Total Return
        </span>
        <span className="font-mono-jb text-sm font-semibold" style={{ color }}>
          {strategy.totalReturn >= 0 ? "+" : ""}
          {strategy.totalReturn.toFixed(2)}%
        </span>
      </div>
      <div>
        <span className="text-[0.5rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
          Win Rate
        </span>
        <span className="font-mono-jb text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {strategy.winRate !== null ? `${(strategy.winRate * 100).toFixed(0)}%` : "—"}
        </span>
      </div>
      <div>
        <span className="text-[0.5rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
          Resolved
        </span>
        <span className="font-mono-jb text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          {strategy.totalIdeas}
        </span>
      </div>
      <div>
        <span className="text-[0.5rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
          Pairing
        </span>
        <span className="font-mono-jb text-[0.6875rem] font-medium" style={{ color: "var(--text-secondary)" }}>
          {strategy.label}
        </span>
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function StrategyEquityCurve({ strategyCurves }: { strategyCurves: StrategyCurvesData }) {
  const { strategies } = strategyCurves;

  const [selectedLabel, setSelectedLabel] = useState<string>(() => strategies[0]?.label ?? "");

  const strategy = strategies.find((s) => s.label === selectedLabel) ?? strategies[0];

  if (!strategy || strategies.length === 0) {
    return (
      <div
        className="flex h-32 items-center justify-center text-[0.625rem] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        No resolved levels yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TabGrid strategies={strategies} selected={selectedLabel} onSelect={setSelectedLabel} />
      <StrategyStats strategy={strategy} />
      <ReturnsCurve strategy={strategy} />
      <p className="text-[0.5625rem]" style={{ color: "var(--text-muted)" }}>
        {strategy.name} ({strategy.label}): exit at the target when hit, otherwise at the paired stop — whichever
        resolves first. Cumulative unweighted % return across all resolved ideas.
      </p>
    </div>
  );
}
