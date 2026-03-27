import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { BriefSection } from "../components/BriefSection";
import { AssetSelector } from "../components/AssetSelector";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { StickyFooter } from "../components/StickyFooter";

import { getLatestBriefByAsset } from "../lib/brief";
import { api } from "../server/api.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";

  return {
    asset,
    brief: await getLatestBriefByAsset(asset)(api),
  };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function Dashboard() {
  const { asset, brief } = useLoaderData<LoaderData>();

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

          <div className="mt-4">
            <DimensionTabs dimensions={brief.dimensions} />
          </div>
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}
