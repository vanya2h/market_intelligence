import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { api } from "../server/api.server";
import { DIMENSIONS } from "../lib/dimension-config";
import { BriefCard } from "../components/BriefCard";
import { RichBriefRenderer } from "../components/RichBrief";
import { PriceDelta } from "../components/PriceDelta";
import { DimensionCard } from "../components/DimensionCard";
import { AssetSelector } from "../components/AssetSelector";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar, DIMENSION_TABS, TAB_LABELS } from "../components/BriefSidebar";
import { SentimentGauge } from "../components/SentimentGauge";
import { SectionBlock } from "../components/SectionBlock";
import { regimeColor } from "../lib/regime-colors";

interface BriefDimension {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
}

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
  dimensions: BriefDimension[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";

  const [briefRes, historyRes] = await Promise.all([
    api.api.briefs.latest[":asset"].$get({ param: { asset } }),
    api.api.briefs.history[":asset"].$get({
      param: { asset },
      query: { take: "30" },
    }),
  ]);

  const brief: BriefData | null = briefRes.ok ? ((await briefRes.json()) as BriefData) : null;
  const history: BriefData[] = historyRes.ok ? ((await historyRes.json()) as BriefData[]) : [];

  const chartData: Record<string, { timestamp: string; value: number }[]> = {};

  for (const dim of Object.keys(DIMENSIONS)) {
    chartData[dim] = [];
  }

  for (const b of history) {
    for (const bd of b.dimensions) {
      const config = DIMENSIONS[bd.dimension];
      if (!config) continue;
      const ctx = bd.context as Record<string, unknown>;
      const value = config.extractChartValue(ctx);
      if (value != null) {
        chartData[bd.dimension]!.push({
          timestamp: b.timestamp,
          value,
        });
      }
    }
  }

  const apiUrl = process.env.API_URL ?? "http://localhost:3001";

  return { asset, brief, chartData, apiUrl };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;


export default function Dashboard() {
  const { asset, brief, chartData, apiUrl } = useLoaderData<LoaderData>();

  const availableDims = brief ? DIMENSION_TABS.filter((dim) => brief.dimensions.some((d) => d.dimension === dim)) : [];

  const [activeTab, setActiveTab] = useState<string>(availableDims[0] ?? "DERIVATIVES");

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
      <div
        className="flex flex-col gap-4 p-3 md:hidden"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
      >
        {/* Composite Index — compact horizontal layout on mobile */}
        {brief.compositeIndex != null && brief.compositeLabel && (
          <div className="flex items-center gap-4">
            <SentimentGauge value={brief.compositeIndex} label={brief.compositeLabel} />
          </div>
        )}

        {/* Regime + Overview in a 2-col grid on mobile */}
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <SectionBlock title="Regime Overview">
            <div className="space-y-0.5">
              {DIMENSION_TABS.map((dim) => {
                const bd = brief.dimensions.find((d) => d.dimension === dim);
                if (!bd) return null;
                const { color, arrow } = regimeColor(bd.regime);
                return (
                  <div
                    key={dim}
                    className="flex items-center justify-between py-1"
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {TAB_LABELS[dim]}
                    </span>
                    <span className="text-[11px] font-medium" style={{ color }}>
                      {bd.regime} {arrow}
                    </span>
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

      {/* Desktop: side-by-side layout */}
      <div className="flex">
        {/* Left sidebar — desktop only */}
        <BriefSidebar brief={brief} />

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Price delta strip */}
          {brief.snapshotPrice != null && (
            <div className="px-3 pt-3 md:px-5 md:pt-4">
              <PriceDelta
                asset={asset}
                snapshotPrice={brief.snapshotPrice}
                briefTimestamp={brief.timestamp}
                apiUrl={apiUrl}
              />
            </div>
          )}

          {/* Brief section */}
          <div className="p-3 md:p-5" style={{ borderBottom: "1px solid var(--border)" }}>
            {brief.richBrief?.blocks ? (
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <span
                    className="text-[10px] font-medium uppercase tracking-widest"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Market Brief
                  </span>
                  <Link
                    to={`/brief/${brief.id}`}
                    className="text-[10px] transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                  >
                    {asset} &middot; Generated{" "}
                    {formatDistanceToNowStrict(new Date(brief.timestamp), { addSuffix: true })} →
                  </Link>
                </div>
                <RichBriefRenderer blocks={brief.richBrief.blocks} />
              </div>
            ) : (
              <BriefCard
                brief={brief.brief}
                compositeIndex={brief.compositeIndex}
                compositeLabel={brief.compositeLabel}
                components={{
                  positioning: brief.positioning,
                  trend: brief.trend,
                  institutionalFlows: brief.institutionalFlows,
                  expertConsensus: brief.expertConsensus,
                }}
                timestamp={brief.timestamp}
                asset={asset}
              />
            )}
          </div>

          {/* Dimension tabs — only show tabs that have data */}
          <div
            className="flex items-center gap-0 overflow-x-auto px-3 md:px-5"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {availableDims.map((dim) => {
              const isActive = activeTab === dim;
              return (
                <button
                  key={dim}
                  onClick={() => setActiveTab(dim)}
                  className={`relative shrink-0 px-3 py-3 text-xs font-medium tracking-wide transition-colors md:px-4 ${isActive ? "tab-active" : ""}`}
                  style={{
                    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {TAB_LABELS[dim]}
                </button>
              );
            })}
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

          {/* Tab content */}
          <div className="flex-1 p-3 md:p-5">
            {availableDims.map((dim) => {
              const bd = brief.dimensions.find((d: BriefDimension) => d.dimension === dim);
              if (!bd) return null;

              return (
                <DimensionCard
                  key={dim}
                  dimension={dim}
                  regime={bd.regime}
                  context={bd.context}
                  interpretation={bd.interpretation}
                  chartData={chartData[dim] ?? []}
                  isActive={activeTab === dim}
                />
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}
