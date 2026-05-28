import type { AssetType, OhlcvCandle } from "@market-intel/api";
import { parseTradeIdea } from "@market-intel/api";
import type { Api } from "@market-intel/api/client";
import { parseResponse } from "hono/client";

export interface TrendPoint {
  time: number;
  value: number;
}

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

export function getTradeHistory(asset: AssetType, take = 90) {
  return async (api: Api): Promise<TrendPoint[]> => {
    const raws = await parseResponse(
      api.api.trades.history[":asset"].$get({ param: { asset }, query: { take: String(Math.min(take, 100)) } }),
    );
    return raws
      .map((raw) => {
        const idea = parseTradeIdea(raw);
        if (idea.confluenceTotal == null) return null;
        return { time: idea.createdAt.getTime(), value: idea.confluenceTotal };
      })
      .filter((p): p is TrendPoint => p !== null);
  };
}

export async function getHourlyCandles(asset: AssetType, since: number, api: Api): Promise<OhlcvCandle[]> {
  const result = await parseResponse(
    api.api.candles[":asset"].$get({ param: { asset }, query: { since: String(since), interval: "1h" } }),
  );
  return result.candles;
}
