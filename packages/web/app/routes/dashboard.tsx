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
import { ComponentProps } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";

  const brief = await getLatestBriefByAsset(asset)(api);
  const tradeIdea = brief ? await getTradeIdeaByBriefId(brief.id)(api).catch(() => null) : null;

  return { asset, brief, tradeIdea };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function Dashboard() {
  const { asset, brief, tradeIdea } = useLoaderData<LoaderData>();

  if (!brief) {
    return (
      <div className="min-h-screen">
        <AppHeader />
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
      <AppHeader />

      {/* Mobile: sidebar content stacked above main */}
      <MobileBriefSummary brief={brief} tradeIdea={tradeIdea} />

      {/* Desktop: side-by-side layout */}
      <div className="flex">
        {/* Left sidebar — desktop only */}
        <BriefSidebar brief={brief} tradeIdea={tradeIdea} />

        {/* Main content */}
        <main className="flex flex-col w-full">
          {/* Subheader: asset selector */}
          <div
            className="sticky top-10 z-20 flex w-full h-full min-h-10 items-center gap-4 px-4 md:px-6"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
          >
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Asset:
            </span>
            <AssetSelector className="h-full" current={asset} />
          </div>
          <div className="flex flex-col gap-4 py-4 md:max-w-3xl">
            {/* Brief section */}
            <Row>
              <BriefSection brief={brief} />
            </Row>

            {/* Trade idea section */}
            {tradeIdea && (
              <Row>
                <TradeIdeaSection tradeIdea={tradeIdea} compact />
              </Row>
            )}

            <Row>
              <DimensionTabs dimensions={brief.dimensions} />
            </Row>
          </div>
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}

const Row = (props: ComponentProps<"div">) => <div className="px-4 md:px-6" {...props} />;
