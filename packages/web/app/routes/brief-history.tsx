import type { AssetType } from "@market-intel/api";
import type { LoaderFunctionArgs } from "react-router";
import { api } from "../server/api.server";

interface BriefHistoryEntry {
  id: string;
  timestamp: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC").toUpperCase() as AssetType;

  const res = await api.api.briefs.history[":asset"].$get({
    param: { asset },
    query: { take: "50" },
  });

  if (!res.ok) return { briefs: [] as BriefHistoryEntry[] };

  const data = (await res.json()) as Array<{ id: string; timestamp: string }>;
  const briefs: BriefHistoryEntry[] = data.map(({ id, timestamp }) => ({ id, timestamp })).reverse();

  return { briefs };
}
