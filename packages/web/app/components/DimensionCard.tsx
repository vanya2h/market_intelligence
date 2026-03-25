import { RegimeBadge } from "./RegimeBadge";
import { MetricRow } from "./MetricRow";
import { MiniChart } from "./MiniChart";
import { DIMENSIONS } from "../lib/dimension-config";

interface ChartPoint {
  timestamp: string;
  value: number;
}

const CHART_COLORS: Record<string, string> = {
  DERIVATIVES: "var(--red)",
  ETFS: "var(--green)",
  SENTIMENT: "var(--amber)",
  HTF: "#6366f1",
};

export function DimensionCard({
  dimension,
  regime,
  context,
  interpretation,
  chartData,
  isActive,
}: {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
  chartData: ChartPoint[];
  isActive: boolean;
}) {
  const config = DIMENSIONS[dimension];
  if (!config) return null;

  const metrics = config.extractMetrics(context);
  const chartColor = CHART_COLORS[dimension] ?? "var(--text-secondary)";

  if (!isActive) return null;

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <span
          className="text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {config.label}
        </span>
        <RegimeBadge regime={regime} />
      </div>

      {/* Chart */}
      <div
        className="mb-5 p-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        <div
          className="mb-1 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {config.chartLabel}
        </div>
        <MiniChart data={chartData} label={config.chartLabel} color={chartColor} />
      </div>

      {/* Metrics */}
      <div>
        {metrics.map((m) => (
          <MetricRow key={m.label} label={m.label} value={m.value} />
        ))}
      </div>

      {/* Interpretation */}
      <details className="mt-4 group">
        <summary
          className="cursor-pointer text-[10px] uppercase tracking-widest transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          Interpretation
        </summary>
        <div
          className="mt-2 text-xs leading-relaxed whitespace-pre-line"
          style={{ color: "var(--text-secondary)" }}
        >
          {interpretation}
        </div>
      </details>
    </div>
  );
}
