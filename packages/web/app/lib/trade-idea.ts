import type {
  AssetType,
  IcWeights,
  OhlcvCandle,
  PerformanceMetrics,
  SignalEffectiveness,
  StrategyCurvesData,
} from "@market-intel/api";
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

export async function getSignalEffectiveness(asset: AssetType, api: Api): Promise<SignalEffectiveness> {
  return parseResponse(api.api.trades["signal-effectiveness"][":asset"].$get({ param: { asset } }));
}

export async function getPerformanceMetrics(asset: AssetType, api: Api): Promise<PerformanceMetrics> {
  return parseResponse(api.api.trades.performance[":asset"].$get({ param: { asset } }));
}

export async function getStrategyCurves(asset: AssetType, api: Api): Promise<StrategyCurvesData> {
  return parseResponse(api.api.trades.performance["strategy-curves"][":asset"].$get({ param: { asset } }));
}

export async function getIcWeights(asset: AssetType, api: Api): Promise<IcWeights> {
  return parseResponse(api.api.trades["ic-weights"][":asset"].$get({ param: { asset } }));
}

export async function getHourlyCandles(asset: AssetType, since: number, api: Api): Promise<OhlcvCandle[]> {
  const result = await parseResponse(
    api.api.candles[":asset"].$get({ param: { asset }, query: { since: String(since), interval: "1h" } }),
  );
  return result.candles;
}
