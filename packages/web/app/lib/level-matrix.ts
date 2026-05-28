import type { LevelMatrixResponse } from "@market-intel/api";
import type { AssetType } from "@market-intel/api";
import type { Api } from "@market-intel/api/client";
import { parseResponse } from "hono/client";

export function getLevelMatrix(asset: AssetType, horizon: number) {
  return async (api: Api): Promise<LevelMatrixResponse> => {
    return parseResponse(
      api.api.trades["level-matrix"][":asset"].$get({
        param: { asset },
        query: { horizon: String(horizon) },
      }),
    );
  };
}
