import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { formatDistanceToNowStrict, format } from "date-fns";
import { api } from "../server/api.server";
import { BriefSection } from "../components/BriefSection";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { StickyFooter } from "../components/StickyFooter";
import { UsdValue } from "../components/UsdValue";
import { Tooltip } from "../components/Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import type { RichBlock } from "../components/RichBrief";

interface BriefData {
  id: string;
  asset: "BTC" | "ETH";
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
      <MobileBriefSummary brief={brief} />

      {/* Desktop: side-by-side layout */}
      <div className="flex">
        {/* Left sidebar — desktop only */}
        <BriefSidebar brief={brief} />

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col md:max-w-3xl">
          {/* Brief section */}
          <div className="p-4 md:p-6">
            <BriefSection brief={brief} asset={brief.asset} />
          </div>

          {/* Dimension tabs + content */}
          <DimensionTabs dimensions={brief.dimensions} />
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}
