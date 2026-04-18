import type { Brief, TradeIdea } from "@market-intel/api";
import { OpportunityGauge } from "./OpportunityGauge";
import { RegimeOverview } from "./RegimeOverview";
import { SectionBlock } from "./SectionBlock";

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
          <RegimeOverview brief={brief} />
        </SectionBlock>
      </div>
    </div>
  );
}
