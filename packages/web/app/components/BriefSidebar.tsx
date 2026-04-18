import type { Brief, TradeIdea } from "@market-intel/api";
import { OpportunityGauge } from "./OpportunityGauge";
import { ConfluenceRows } from "./OpportunityGauge";
import { RegimeOverview } from "./RegimeOverview";
import { SectionBlock } from "./SectionBlock";

export function BriefSidebar({ brief, tradeIdea }: { brief: Brief; tradeIdea: TradeIdea | null }) {
  return (
    <aside
      className="sticky top-10 hidden w-72 shrink-0 flex-col overflow-y-auto p-5 md:flex"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-card)",
        height: "calc(100vh - 98px)",
      }}
    >
      {tradeIdea && tradeIdea.confluence && (
        <SectionBlock
          title="Opportunity Score"
          className="mb-6"
          tooltip="Directional edge score (-100 to +100) derived from 4 dimensions: HTF structure, derivatives positioning, ETF flows, and exchange flows. Positive = buy setup, negative = sell setup, near zero = no edge."
        >
          <OpportunityGauge tradeIdea={tradeIdea} />
          <div className="mt-4">
            <ConfluenceRows confluence={tradeIdea.confluence} />
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Regime Overview" className="mb-6">
        <RegimeOverview brief={brief} />
      </SectionBlock>
    </aside>
  );
}
