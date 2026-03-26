import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { api } from "../server/api.server";
import { DIMENSIONS } from "../lib/dimension-config";
import { BriefSection } from "../components/BriefSection";
import { AssetSelector } from "../components/AssetSelector";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { StickyFooter } from "../components/StickyFooter";

import type { RichBlock } from "../components/RichBrief";

interface BriefData {
  id: string;
  brief: string;
  richBrief?: { blocks: RichBlock[] } | null;
  snapshotPrice?: number | null;
  compositeIndex: number | null;
  compositeLabel: string | null;
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
  timestamp: string;
  dimensions: { dimension: string; regime: string; context: Record<string, unknown>; interpretation: string }[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";

  const briefRes = await api.api.briefs.latest[":asset"].$get({ param: { asset } });
  const brief: BriefData | null = briefRes.ok ? ((await briefRes.json()) as BriefData) : null;

  return { asset, brief };
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
        <main className="flex min-w-0 flex-1 flex-col md:max-w-3xl">
          {/* Brief section */}
          <div className="p-4 md:p-6">
            <BriefSection brief={brief} asset={asset} />
          </div>

          {/* Low-data disclaimer */}
          <div
            className="mx-3 mt-3 flex items-center gap-2 rounded px-3 py-2 text-xs md:mx-5 md:mt-4"
            style={{
              background: "var(--surface-secondary)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
          >
            <span>⚠</span>
            <span>Limited data available — charts may not be fully representative yet.</span>
          </div>

          {/* Dimension tabs + content */}
          <DimensionTabs dimensions={brief.dimensions} />
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}
