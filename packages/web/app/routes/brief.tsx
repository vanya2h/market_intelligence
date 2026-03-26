import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { formatDistanceToNowStrict, format } from "date-fns";
import { api } from "../server/api.server";
import { DIMENSIONS } from "../lib/dimension-config";
import { BriefCard } from "../components/BriefCard";
import { RichBriefRenderer } from "../components/RichBrief";
import { DimensionCard } from "../components/DimensionCard";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar, DIMENSION_TABS, TAB_LABELS } from "../components/BriefSidebar";
import { SentimentGauge } from "../components/SentimentGauge";
import { SectionBlock } from "../components/SectionBlock";
import { regimeColor } from "../lib/regime-colors";
import { UsdValue } from "../components/UsdValue";
import { Tooltip } from "../components/Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";

import type { RichBlock } from "../components/RichBrief";

interface BriefDimension {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
}

interface BriefData {
  id: string;
  asset: string;
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
  prevId: string | null;
  nextId: string | null;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Response("Missing brief ID", { status: 400 });

  const res = await api.api.briefs[":id"].$get({ param: { id } });

  if (!res.ok) throw new Response("Brief not found", { status: 404 });

  const brief = (await res.json()) as BriefData;

  return { brief };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;


export default function BriefPage() {
  const { brief } = useLoaderData<LoaderData>();

  const availableDims = DIMENSION_TABS.filter((dim) => brief.dimensions.some((d) => d.dimension === dim));

  const [activeTab, setActiveTab] = useState<string>(availableDims[0] ?? "DERIVATIVES");

  const briefDate = new Date(brief.timestamp);

  return (
    <div className="min-h-screen">
      <AppHeader currentBriefId={brief.id}>
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3">
            <Tooltip side="bottom" content="The date when report was generated">
              <span
                className="font-mono-jb text-[11px] font-medium tabular-nums inline-flex items-center gap-1.5"
                style={{ color: "var(--text-primary)" }}
              >
                {format(briefDate, "MMM d, yyyy · HH:mm")}
                <InfoCircledIcon style={{ color: "var(--text-muted)", width: 13, height: 13 }} />
              </span>
            </Tooltip>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {formatDistanceToNowStrict(briefDate, { addSuffix: true })}
            </span>
          </div>
          <div className="grow" />
          <div className="flex items-center gap-1">
            {brief.prevId ? (
              <Link
                to={`/brief/${brief.prevId}`}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                ← Older
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)", opacity: 0.4 }}>
                ← Older
              </span>
            )}
            <div className="h-3" style={{ borderLeft: "1px solid var(--border)" }} />
            {brief.nextId ? (
              <Link
                to={`/brief/${brief.nextId}`}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Newer →
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)", opacity: 0.4 }}>
                Newer →
              </span>
            )}
          </div>
          {brief.snapshotPrice != null && (
            <Tooltip side="bottom" content="Price at the moment when report is generated">
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <UsdValue value={brief.snapshotPrice} />
                <InfoCircledIcon style={{ color: "var(--text-muted)", width: 13, height: 13 }} />
              </span>
            </Tooltip>
          )}
        </div>
      </AppHeader>

      {/* Timestamp header */}

      {/* Mobile: sidebar content stacked above main */}
      <div
        className="flex flex-col gap-4 p-3 md:hidden"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
      >
        {brief.compositeIndex != null && brief.compositeLabel && (
          <div className="flex items-center gap-4">
            <SentimentGauge value={brief.compositeIndex} label={brief.compositeLabel} />
          </div>
        )}

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
                asset={brief.asset}
              />
            )}
          </div>

          {/* Dimension tabs */}
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
                  chartData={[]}
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
