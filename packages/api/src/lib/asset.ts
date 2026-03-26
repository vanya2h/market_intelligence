import { $Enums } from "@market-intel/pipeline";
import { Jsonify } from "../common/json.js";

export const Asset = {
  ETH: "ETH",
  BTC: "BTC",
} as const satisfies {
  [K in $Enums.Asset]: Extract<$Enums.Asset, K>;
};
export type AssetType = keyof typeof Asset;

export type AssetPrice = {
  timestamp: Date;
  price: number;
  asset: AssetType;
};

export function parseAssetPrice(raw: Jsonify<AssetPrice>): AssetPrice {
  return {
    timestamp: new Date(raw.timestamp),
    price: raw.price,
    asset: raw.asset,
  };
}
