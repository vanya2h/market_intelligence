import { parseTradeIdea } from "@market-intel/api";
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
