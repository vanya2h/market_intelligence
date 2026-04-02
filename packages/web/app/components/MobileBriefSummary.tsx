import type { Brief, TradeIdea } from "@market-intel/api";
import { OpportunityGauge } from "./OpportunityGauge";
import { SectionBlock } from "./SectionBlock";
import { regimeColor, regimeLabel } from "../lib/regime-colors";
import { RelativeTime } from "./RelativeTime";
import { DIMENSION_LABELS, DIMENSIONS } from "../lib/dimensions";

export function MobileBriefSummary({ brief, tradeIdea }: { brief: Brief; tradeIdea: TradeIdea | null }) {
  return (
    <div
      className="flex flex-col gap-4 p-3 md:hidden"
      style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
    >
      {tradeIdea && tradeIdea.confluence && (
        <div className="flex items-center gap-4">
          <OpportunityGauge tradeIdea={tradeIdea} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <SectionBlock title="Regime Overview">
          <div className="space-y-0.5">
            {DIMENSIONS.map((dim) => {
              const bd = brief.dimensions.find((d) => d.dimension === dim);
              if (!bd) return null;
              const { color, arrow } = regimeColor(bd.regime);
              const sinceDate = bd.since ? new Date(bd.since) : null;
              return (
                <div
                  key={dim}
                  className="flex flex-col gap-0 py-1"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[0.6875rem]" style={{ color: "var(--text-secondary)" }}>
                      {DIMENSION_LABELS[dim]}
                    </span>
                    <span className="text-[0.6875rem] font-medium" style={{ color }}>
                      {regimeLabel(bd.regime)} {arrow}
                    </span>
                  </div>
                  {sinceDate && (
                    <RelativeTime
                      date={sinceDate}
                      className="font-mono-jb text-[0.5625rem] tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    />
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
            ].map(({ label, value }) => {
              if (value == null) return null;
              const color = value < 30 ? "var(--red)" : value > 70 ? "var(--green)" : "var(--amber)";
              return (
                <div
                  key={label}
                  className="flex items-center justify-between py-1"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <span className="text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </span>
                  <span className="font-mono-jb text-[0.6875rem] font-medium tabular-nums" style={{ color }}>
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
