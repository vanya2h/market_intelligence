import { bySchema } from "@vanya2h/utils/zod";
import z from "zod";
import { AssetType } from "./types.js";

export const AssetTypeEnum = z.enum(["BTC", "ETH"] as const satisfies AssetType[]);

export function parseAssetType<T extends string>(x: T): AssetType {
  return bySchema(AssetTypeEnum, x as AssetType);
}
