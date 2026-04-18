import { AssetType, Brief, parseBrief } from "@market-intel/api";
import type { Api } from "@market-intel/api/client";
import { parseResponse } from "hono/client";

export function getLatestBriefByAsset(asset: AssetType) {
  return async (api: Api): Promise<Brief> => {
    const raw = await parseResponse(api.api.briefs.latest[":asset"].$get({ param: { asset } }));
    return parseBrief(raw);
  };
}

export function getBriefById(id: string) {
  return async (api: Api): Promise<Brief> => {
    const raw = await parseResponse(api.api.briefs[":id"].$get({ param: { id } }));
    return parseBrief(raw);
  };
}
