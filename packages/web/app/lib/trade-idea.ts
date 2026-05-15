import type { AssetType, OhlcvCandle } from "@market-intel/api";
import { parseTradeIdea } from "@market-intel/api";
import type { Api } from "@market-intel/api/client";
import { parseResponse } from "hono/client";

export function getTradeIdeaByBriefId(briefId: string) {
  return async (api: Api) => {
    const raw = await parseResponse(api.api.trades["by-brief"][":briefId"].$get({ param: { briefId } }));
    return parseTradeIdea(raw);
  };
}

export async function getCandles(asset: AssetType, since: number, api: Api): Promise<OhlcvCandle[]> {
  const result = await parseResponse(
    api.api.candles[":asset"].$get({ param: { asset }, query: { since: String(since) } }),
  );
  return result.candles;
}

export async function getHourlyCandles(asset: AssetType, since: number, api: Api): Promise<OhlcvCandle[]> {
  const result = await parseResponse(
    api.api.candles[":asset"].$get({ param: { asset }, query: { since: String(since), interval: "1h" } }),
  );
  return result.candles;
}
