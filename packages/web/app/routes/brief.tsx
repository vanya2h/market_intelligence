import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { format } from "date-fns";
import { RelativeTime } from "../components/RelativeTime";
import { BriefSection } from "../components/BriefSection";
import { AppHeader } from "../components/AppHeader";
import { BriefSidebar } from "../components/BriefSidebar";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { DimensionTabs } from "../components/DimensionTabs";
import { TradeIdeaSection } from "../components/TradeIdeaSection";
import { StickyFooter } from "../components/StickyFooter";
import { UsdValue } from "../components/UsdValue";
import { Tooltip } from "../components/Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { getBriefById } from "../lib/brief";
import { getTradeIdeaByBriefId } from "../lib/trade-idea";
import { api } from "../server/api.server";
import { ComponentProps } from "react";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    throw new Response("Missing brief ID", { status: 400 });
  }

  const [brief, tradeIdea] = await Promise.all([
    getBriefById(id)(api),
    getTradeIdeaByBriefId(id)(api).catch(() => null),
  ]);

  return { brief, tradeIdea };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function BriefPage() {
  const { brief, tradeIdea } = useLoaderData<LoaderData>();

  return (
    <div className="min-h-screen">
      <AppHeader currentBriefId={brief.id} />

      {/* Mobile: sidebar content stacked above main */}
      <MobileBriefSummary brief={brief} tradeIdea={tradeIdea} />

      {/* Desktop: side-by-side layout */}
      <div className="flex">
        {/* Left sidebar — desktop only */}
        <BriefSidebar brief={brief} tradeIdea={tradeIdea} />

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Brief section */}
          <div className="flex flex-col gap-4 py-4 md:max-w-3xl">
            <Row>
              <BriefSection brief={brief} />
            </Row>

            {/* Trade idea section */}
            {tradeIdea && (
              <Row>
                <TradeIdeaSection tradeIdea={tradeIdea} />
              </Row>
            )}

            {/* Dimension tabs + content */}
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
