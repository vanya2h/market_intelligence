import { RegimeBadge } from "./RegimeBadge";
import { MetricRow } from "./MetricRow";
import { MiniChart } from "./MiniChart";
import { DIMENSIONS } from "../lib/dimension-config";

interface ChartPoint {
  timestamp: string;
  value: number;
}

export function DimensionCard({
  dimension,
  regime,
  context,
  interpretation,
  chartData,
}: {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
  chartData: ChartPoint[];
}) {
  const config = DIMENSIONS[dimension];
  if (!config) return null;

  const metrics = config.extractMetrics(context);
  const chartColor =
    dimension === "SENTIMENT"
      ? "#f59e0b"
      : dimension === "DERIVATIVES"
        ? "#ef4444"
        : dimension === "ETFS"
          ? "#22c55e"
          : "#6366f1";

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-3 flex items-start justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">{config.label}</h3>
        <RegimeBadge regime={regime} />
      </div>

      <div className="mb-3 divide-y divide-zinc-800/50">
        {metrics.map((m) => (
          <MetricRow key={m.label} label={m.label} value={m.value} />
        ))}
      </div>

      <MiniChart data={chartData} label={config.chartLabel} color={chartColor} />

      <details className="mt-4 group">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          Agent interpretation
        </summary>
        <div className="mt-2 text-xs leading-relaxed text-zinc-400 whitespace-pre-line">
          {interpretation}
        </div>
      </details>
    </div>
  );
}
