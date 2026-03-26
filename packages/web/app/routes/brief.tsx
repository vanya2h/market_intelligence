import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { formatDistanceToNowStrict, format } from "date-fns";
import { BriefSection } from "../components/BriefSection";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { StickyFooter } from "../components/StickyFooter";
import { UsdValue } from "../components/UsdValue";
import { Tooltip } from "../components/Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { getBriefById } from "../lib/brief";
import { api } from "../server/api.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    throw new Response("Missing brief ID", { status: 400 });
  }

  return {
    brief: await getBriefById(id)(api),
  };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function BriefPage() {
  const { brief } = useLoaderData<LoaderData>();

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
                {format(brief.timestamp, "MMM d, yyyy · HH:mm")}
                <InfoCircledIcon style={{ color: "var(--text-muted)", width: 13, height: 13 }} />
              </span>
            </Tooltip>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {formatDistanceToNowStrict(brief.timestamp, { addSuffix: true })}
            </span>
          </div>
          <div className="grow" />
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
            <BriefSection brief={brief} />
          </div>

          {/* Dimension tabs + content */}
          <DimensionTabs dimensions={brief.dimensions} />
        </main>
      </div>
      <StickyFooter />
    </div>
  );
}
