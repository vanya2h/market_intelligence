import { AssetType, AssetPrice, parseAssetPrice } from "@market-intel/api";
import { parseResponse } from "hono/client";
import type { Api } from "@market-intel/api/client";

export function getAssetPrice(asset: AssetType) {
  return async (api: Api): Promise<AssetPrice> => {
    const res = await parseResponse(api.api.price[":asset"].$get({ param: { asset } }));
    return parseAssetPrice(res);
  };
}
