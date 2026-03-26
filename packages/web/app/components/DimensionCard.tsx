import { MarkdownContent } from "./MarkdownContent";
import { RegimeBadge } from "./RegimeBadge";
import { MetricRow } from "./MetricRow";
import { MiniChart } from "./MiniChart";
import { SectionBlock } from "./SectionBlock";
import { DIMENSIONS } from "../lib/dimension-config";
import type { MetricDef } from "../lib/dimension-config";

interface ChartPoint {
  timestamp: string;
  value: number;
}

function renderMetricGroups(metrics: MetricDef[]) {
  const ungrouped = metrics.filter((m) => !m.group);
  const grouped = metrics.filter((m) => m.group);

  const groups = grouped.reduce<Record<string, MetricDef[]>>((acc, m) => {
    const key = m.group!;
    (acc[key] ??= []).push(m);
    return acc;
  }, {});

  return (
    <>
      {ungrouped.length > 0 && (
        <div>
          {ungrouped.map((m) => (
            <MetricRow key={m.label} label={m.label} value={m.value} signal={m.signal} />
          ))}
        </div>
      )}
      {Object.entries(groups).map(([groupName, rows]) => (
        <SectionBlock key={groupName} title={groupName}>
          {rows.map((m) => (
            <MetricRow key={m.label} label={m.label} value={m.value} signal={m.signal} />
          ))}
        </SectionBlock>
      ))}
    </>
  );
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
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {config.label}
        </span>
        <RegimeBadge regime={regime} />
      </div>

      {/* Chart */}
      <div className="mb-5 p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {config.chartLabel}
        </div>
        <MiniChart data={chartData} label={config.chartLabel} color={chartColor} />
      </div>

      {/* Metrics — grouped by group field, ungrouped rows at top */}
      <div className="space-y-4">{renderMetricGroups(metrics)}</div>

      {/* Interpretation */}
      <SectionBlock title="LLM Interpretation" className="mt-8">
        <MarkdownContent className="mt-2">{interpretation}</MarkdownContent>
      </SectionBlock>
    </div>
  );
}
