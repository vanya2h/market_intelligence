import type { Regime } from "@market-intel/api";
import { MarkdownContent } from "./MarkdownContent";
import { RegimeBadge } from "./RegimeBadge";
import { MetricRow } from "./MetricRow";
import { SectionBlock } from "./SectionBlock";
import { DIMENSIONS } from "../lib/dimension-config";
import type { MetricDef } from "../lib/dimension-config";

function eventColor(type: string): string {
  if (
    type.includes("bullish") ||
    type.includes("inflow") ||
    type.includes("reclaim") ||
    type.includes("golden") ||
    type.includes("greed") ||
    type.includes("oversold")
  )
    return "var(--green)";
  if (
    type.includes("bearish") ||
    type.includes("outflow") ||
    type.includes("break") ||
    type.includes("death") ||
    type.includes("fear") ||
    type.includes("overbought") ||
    type.includes("capitulation") ||
    type.includes("deteriorating")
  )
    return "var(--red)";
  return "var(--amber)";
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

export function DimensionCard({
  dimension,
  regime,
  context,
  interpretation,
  isActive,
}: {
  dimension: string;
  regime: Regime;
  context: Record<string, unknown>;
  interpretation: string;
  isActive: boolean;
}) {
  const config = DIMENSIONS[dimension];
  if (!config) return null;

  const metrics = config.extractMetrics(context);
  const events = config.extractEvents(context);

  if (!isActive) return null;

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[0.625rem] font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {config.label}
        </span>
        <RegimeBadge regime={regime} />
      </div>

      {/* Events */}
      {events.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {events.map((evt, i) => (
            <span
              key={`${evt.type}-${i}`}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.625rem] font-medium"
              style={{
                color: eventColor(evt.type),
                background: "var(--bg-hover)",
                border: "1px solid var(--border-subtle)",
              }}
              title={evt.detail}
            >
              {evt.type.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}

      {/* Metrics — grouped by group field, ungrouped rows at top */}
      <div className="space-y-4">{renderMetricGroups(metrics)}</div>

      {/* Interpretation */}
      <SectionBlock title="LLM Interpretation" className="mt-8">
        <MarkdownContent className="mt-2">{interpretation}</MarkdownContent>
      </SectionBlock>
    </div>
  );
}
