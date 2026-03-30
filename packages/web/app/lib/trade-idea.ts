import { parseTradeIdea } from "@market-intel/api";
import type { SignalEffectiveness } from "@market-intel/api";
import { parseResponse } from "hono/client";
import type { Api } from "@market-intel/api/client";

export function getTradeIdeaByBriefId(briefId: string) {
  return async (api: Api) => {
    const raw = await parseResponse(
      api.api.trades["by-brief"][":briefId"].$get({ param: { briefId } }),
    );
    return parseTradeIdea(raw);
  };
}

export async function getSignalEffectiveness(asset: "BTC" | "ETH", api: Api): Promise<SignalEffectiveness> {
  return parseResponse(
    api.api.trades["signal-effectiveness"][":asset"].$get({ param: { asset } }),
  );
}
