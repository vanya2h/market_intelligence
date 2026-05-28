import type { Brief, TradeIdea } from "@market-intel/api";
import type { TrendPoint } from "../lib/trade-idea";
import { OpportunityGauge } from "./OpportunityGauge";
import { RegimeOverview } from "./RegimeOverview";
import { SectionBlock } from "./SectionBlock";
import { TrendStrengthChart } from "./TrendStrengthChart";

export function BriefSidebar({
  brief,
  tradeIdea,
  trendHistory,
}: {
  brief: Brief;
  tradeIdea: TradeIdea | null;
  trendHistory: TrendPoint[];
}) {
  return (
    <aside
      className="sticky top-10 hidden w-72 shrink-0 flex-col overflow-y-auto p-5 md:flex"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-card)",
        height: "calc(100vh - 98px)",
      }}
    >
      {tradeIdea && (
        <SectionBlock
          title="7-Day Forecast"
          className="mb-6"
          tooltip="7-day directional forecast (-100 to +100). Positive = model predicts price higher in 7 days, negative = lower, near zero = no clear edge. Produced by a Ridge regression trained on HTF structure and derivatives positioning against 168h forward returns."
        >
          <OpportunityGauge tradeIdea={tradeIdea} />
          {trendHistory.length >= 2 && (
            <div className="mt-3" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.75rem" }}>
              <div className="mb-1 text-[0.5625rem] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                History
              </div>
              <TrendStrengthChart data={trendHistory} />
            </div>
          )}
        </SectionBlock>
      )}

      <SectionBlock title="Regime Overview" className="mb-6">
        <RegimeOverview brief={brief} />
      </SectionBlock>
    </aside>
  );
}
