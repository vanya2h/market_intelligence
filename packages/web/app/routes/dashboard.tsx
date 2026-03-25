import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { api } from "../server/api.server";
import { DIMENSIONS } from "../lib/dimension-config";
import { BriefCard } from "../components/BriefCard";
import { RichBriefRenderer } from "../components/RichBrief";
import { PriceDelta } from "../components/PriceDelta";
import { DimensionCard } from "../components/DimensionCard";
import { AssetSelector } from "../components/AssetSelector";
import { SentimentGauge } from "../components/SentimentGauge";
import { regimeColor } from "../lib/regime-colors";

interface BriefDimension {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
}

import type { RichBlock } from "../components/RichBrief";

interface BriefData {
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

const DIMENSION_TABS = ["DERIVATIVES", "ETFS", "SENTIMENT", "HTF"] as const;

const TAB_LABELS: Record<string, string> = {
  DERIVATIVES: "Derivatives",
  ETFS: "ETFs",
  SENTIMENT: "Sentiment",
  HTF: "HTF Structure",
};

function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="text-[10px] uppercase tracking-wider tabular-nums"
      style={{ color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}
    >
      {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export default function Dashboard() {
  const { asset, brief, chartData, apiUrl } = useLoaderData<LoaderData>();

  const availableDims = brief ? DIMENSION_TABS.filter((dim) => brief.dimensions.some((d) => d.dimension === dim)) : [];

  const [activeTab, setActiveTab] = useState<string>(availableDims[0] ?? "DERIVATIVES");

  if (!brief) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <AssetSelector current={asset} />
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
    );
  }

  return (
    <div className="min-h-screen">
      {/* Top navigation bar */}
      <nav
        className="sticky top-0 z-10 flex h-10 items-center justify-between px-4"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
      >
        <div className="flex items-center gap-4">
          <img src="/asterisk.png" alt="" className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Vanya2h's Intelligence System
          </span>
          <div className="h-4" style={{ borderLeft: "1px solid var(--border)" }} />
          <AssetSelector current={asset} />
        </div>
        <div className="flex items-center gap-3">
          <LiveClock />
          <div className="flex items-center gap-1.5">
            <div className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--green)" }} />
            <span className="text-[10px] font-medium" style={{ color: "var(--green)" }}>
              LIVE
            </span>
          </div>
        </div>
      </nav>

      {/* Main 3-column layout */}
      <div className="flex">
        {/* Left sidebar */}
        <aside
          className="sticky top-10 flex w-72 shrink-0 flex-col overflow-y-auto p-5"
          style={{
            borderRight: "1px solid var(--border)",
            background: "var(--bg-card)",
            height: "calc(100vh - 2.5rem)",
          }}
        >
          {/* Composite Index */}
          {brief.compositeIndex != null && brief.compositeLabel && (
            <div className="mb-6">
              <div
                className="mb-3 text-[10px] font-medium uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                Composite Index
              </div>
              <SentimentGauge value={brief.compositeIndex} label={brief.compositeLabel} />
            </div>
          )}

          {/* Dimension Regimes */}
          <div className="mb-6">
            <div
              className="mb-3 text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              Regime Overview
            </div>
            <div className="space-y-1">
              {DIMENSION_TABS.map((dim) => {
                const bd = brief.dimensions.find((d) => d.dimension === dim);
                if (!bd) return null;
                const { color, arrow } = regimeColor(bd.regime);
                return (
                  <div
                    key={dim}
                    className="flex items-center justify-between py-1.5"
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {TAB_LABELS[dim]}
                    </span>
                    <span className="text-xs font-medium" style={{ color }}>
                      {bd.regime} {arrow}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overview Stats */}
          <div>
            <div
              className="mb-3 text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              Overview
            </div>
            <div className="space-y-1">
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
                    className="flex items-center justify-between py-1.5"
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {label}
                    </span>
                    <span
                      className="text-xs font-medium tabular-nums"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color,
                      }}
                    >
                      {Math.round(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex flex-1 flex-col">
          {/* Price delta strip */}
          {brief.snapshotPrice != null && (
            <div className="px-5 pt-4">
              <PriceDelta
                asset={asset}
                snapshotPrice={brief.snapshotPrice}
                briefTimestamp={brief.timestamp}
                apiUrl={apiUrl}
              />
            </div>
          )}

          {/* Brief section */}
          <div className="p-5" style={{ borderBottom: "1px solid var(--border)" }}>
            {brief.richBrief?.blocks ? (
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <span
                    className="text-[10px] font-medium uppercase tracking-widest"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Market Brief
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {asset} &middot; Generated{" "}
                    {formatDistanceToNowStrict(new Date(brief.timestamp), { addSuffix: true })}
                  </span>
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
          <div className="flex items-center gap-0 px-5" style={{ borderBottom: "1px solid var(--border)" }}>
            {availableDims.map((dim) => {
              const isActive = activeTab === dim;
              return (
                <button
                  key={dim}
                  onClick={() => setActiveTab(dim)}
                  className={`relative px-4 py-3 text-xs font-medium tracking-wide transition-colors ${isActive ? "tab-active" : ""}`}
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
            className="mx-5 mt-4 flex items-center gap-2 rounded px-3 py-2 text-xs"
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
          <div className="flex-1 p-5">
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
