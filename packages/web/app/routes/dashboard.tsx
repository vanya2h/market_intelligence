import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { api } from "../server/api.server";
import { DIMENSIONS } from "../lib/dimension-config";
import { BriefCard } from "../components/BriefCard";
import { DimensionCard } from "../components/DimensionCard";
import { AssetSelector } from "../components/AssetSelector";

interface BriefDimension {
  dimension: string;
  regime: string;
  context: Record<string, unknown>;
  interpretation: string;
}

interface BriefData {
  brief: string;
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

  const brief: BriefData | null = briefRes.ok
    ? ((await briefRes.json()) as BriefData)
    : null;
  const history: BriefData[] = historyRes.ok
    ? ((await historyRes.json()) as BriefData[])
    : [];

  // Build chart data per dimension from history
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

  return { asset, brief, chartData };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function Dashboard() {
  const { asset, brief, chartData } = useLoaderData<LoaderData>();

  if (!brief) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <AssetSelector current={asset} />
        <p className="text-zinc-500">
          No brief data available for {asset}. Run{" "}
          <code className="rounded bg-zinc-800 px-2 py-0.5 text-sm">
            pnpm brief
          </code>{" "}
          first.
        </p>
      </div>
    );
  }

  const dimensionOrder = ["DERIVATIVES", "ETFS", "SENTIMENT", "HTF"] as const;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Market Intel</h1>
        <AssetSelector current={asset} />
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Brief card spans full width */}
        <div className="lg:col-span-2">
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
        </div>

        {/* Dimension cards in 2x2 grid */}
        {dimensionOrder.map((dim) => {
          const bd = brief.dimensions.find(
            (d: BriefDimension) => d.dimension === dim
          );
          if (!bd) return null;

          return (
            <DimensionCard
              key={dim}
              dimension={dim}
              regime={bd.regime}
              context={bd.context}
              interpretation={bd.interpretation}
              chartData={chartData[dim] ?? []}
            />
          );
        })}
      </div>
    </div>
  );
}
