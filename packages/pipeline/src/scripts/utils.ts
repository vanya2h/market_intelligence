import { parseAssetType } from "../models.js";

export function parseAsset() {
  return process.argv.includes("--asset")
    ? parseAssetType(process.argv[process.argv.indexOf("--asset") + 1] ?? "")
    : "BTC";
}
