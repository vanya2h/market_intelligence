import { ComponentProps } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AppHeader } from "../components/AppHeader";
import { BriefSection } from "../components/BriefSection";
import { BriefSidebar } from "../components/BriefSidebar";
import { DimensionTabs } from "../components/DimensionTabs";
import { MobileBriefSummary } from "../components/MobileBriefSummary";
import { StickyFooter } from "../components/StickyFooter";
import { TradeIdeaSection } from "../components/TradeIdeaSection";
import { getBriefById } from "../lib/brief";
import { getCandles, getTradeIdeaByBriefId } from "../lib/trade-idea";
import { api } from "../server/api.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    throw new Response("Missing brief ID", { status: 400 });
  }

  const [brief, tradeIdea] = await Promise.all([
    getBriefById(id)(api),
    getTradeIdeaByBriefId(id)(api).catch(() => null),
  ]);

  const candles = tradeIdea
    ? await getCandles(tradeIdea.asset, tradeIdea.createdAt.getTime(), api).catch(() => [])
    : [];

  return { brief, tradeIdea, candles };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function BriefPage() {
  const { brief, tradeIdea, candles } = useLoaderData<LoaderData>();

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
                <TradeIdeaSection tradeIdea={tradeIdea} candles={candles} />
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
