import { parseTradeIdea } from "@market-intel/api";
import type { AssetType, OhlcvCandle, SignalEffectiveness, PerformanceMetrics } from "@market-intel/api";
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

export async function getCandles(asset: AssetType, since: number, api: Api): Promise<OhlcvCandle[]> {
  const result = await parseResponse(
    api.api.candles[":asset"].$get({ param: { asset }, query: { since: String(since) } }),
  );
  return result.candles;
}

export async function getSignalEffectiveness(asset: AssetType, api: Api): Promise<SignalEffectiveness> {
  return parseResponse(
    api.api.trades["signal-effectiveness"][":asset"].$get({ param: { asset } }),
  );
}

export async function getPerformanceMetrics(asset: AssetType, api: Api): Promise<PerformanceMetrics> {
  return parseResponse(
    api.api.trades.performance[":asset"].$get({ param: { asset } }),
  );
}
