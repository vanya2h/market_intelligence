import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { BriefSection } from "../components/BriefSection";
import { AssetSelector } from "../components/AssetSelector";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { TradeIdeaSection } from "../components/TradeIdeaSection";
import { StickyFooter } from "../components/StickyFooter";

import { getLatestBriefByAsset } from "../lib/brief";
import { getTradeIdeaByBriefId } from "../lib/trade-idea";
import { api } from "../server/api.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";

  const brief = await getLatestBriefByAsset(asset)(api);
  const tradeIdea = brief
    ? await getTradeIdeaByBriefId(brief.id)(api).catch(() => null)
    : null;

  return { asset, brief, tradeIdea };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function Dashboard() {
  const { asset, brief, tradeIdea } = useLoaderData<LoaderData>();

  if (!brief) {
    return (
      <div className="min-h-screen">
        <AppHeader>
          <AssetSelector current={asset} />
        </AppHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 pt-32">
          <p style={{ color: "var(--text-muted)" }}>
            No data for {asset}.{" "}
            <code
              className="px-2 py-0.5 text-sm"
              style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            >
              pnpm brief
            </code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader>
        <AssetSelector current={asset} />
      </AppHeader>

      {/* Mobile: sidebar content stacked above main */}
      <MobileBriefSummary brief={brief} />

      {/* Desktop: side-by-side layout */}
      <div className="flex">
        {/* Left sidebar — desktop only */}
        <BriefSidebar brief={brief} />

        {/* Main content */}
        <main className="flex flex-col md:max-w-3xl">
          {/* Brief section */}
          <div className="p-4 md:p-6">
            <BriefSection brief={brief} />
          </div>

          {/* Trade idea section */}
          {tradeIdea && (
            <div className="px-4 pb-4 md:px-6 md:pb-6">
              <TradeIdeaSection tradeIdea={tradeIdea} />
            </div>
          )}

          <div className="mt-4">
            <DimensionTabs dimensions={brief.dimensions} />
          </div>
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}
