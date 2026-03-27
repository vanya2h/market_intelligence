import type { Brief } from "@market-intel/api";
import { SentimentGauge } from "./SentimentGauge";
import { SectionBlock } from "./SectionBlock";
import { DIMENSION_TABS, TAB_LABELS } from "./BriefSidebar";
import { regimeColor, regimeLabel } from "../lib/regime-colors";
import { formatDistanceToNowStrict } from "date-fns";

export function MobileBriefSummary({ brief }: { brief: Brief }) {
  return (
    <div
      className="flex flex-col gap-4 p-3 md:hidden"
      style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
    >
      {brief.compositeIndex != null && brief.compositeLabel && (
        <div className="flex items-center gap-4">
          <SentimentGauge value={brief.compositeIndex} label={brief.compositeLabel} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <SectionBlock title="Regime Overview">
          <div className="space-y-0.5">
            {DIMENSION_TABS.map((dim) => {
              const bd = brief.dimensions.find((d) => d.dimension === dim);
              if (!bd) return null;
              const { color, arrow } = regimeColor(bd.regime);
              const sinceDate = bd.since ? new Date(bd.since) : null;
              const sinceLabel = sinceDate ? formatDistanceToNowStrict(sinceDate, { addSuffix: true }) : null;
              return (
                <div
                  key={dim}
                  className="flex flex-col gap-0 py-1"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {TAB_LABELS[dim]}
                    </span>
                    <span className="text-[11px] font-medium" style={{ color }}>
                      {regimeLabel(bd.regime)} {arrow}
                    </span>
                  </div>
                  {sinceLabel && (
                    <span className="font-mono-jb text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {sinceLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </SectionBlock>
        <SectionBlock title="Overview">
          <div className="space-y-0.5">
            {[
              { label: "Positioning", value: brief.positioning },
              { label: "Trend", value: brief.trend },
              { label: "Inst. Flows", value: brief.institutionalFlows },
              { label: "Expert Cons.", value: brief.expertConsensus },
              { label: "Mom. Div.", value: brief.momentumDivergence },
              { label: "Volatility", value: brief.volatility },
            ].map(({ label, value }) => {
              if (value == null) return null;
              const color = value < 30 ? "var(--red)" : value > 70 ? "var(--green)" : "var(--amber)";
              return (
                <div
                  key={label}
                  className="flex items-center justify-between py-1"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </span>
                  <span className="font-mono-jb text-[11px] font-medium tabular-nums" style={{ color }}>
                    {Math.round(value)}
                  </span>
                </div>
              );
            })}
          </div>
        </SectionBlock>
      </div>
    </div>
  );
}
