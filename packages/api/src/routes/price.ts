/**
 * Lightweight live price endpoint.
 *
 * Fetches the current price from Binance ticker API, cached in Redis
 * for 10 seconds to avoid hammering upstream on every client poll.
 * Used by the web dashboard to show price delta since brief generation.
 */

import { describeRoute, validator } from "hono-openapi";
import { getCached } from "@market-intel/pipeline";
import { createController } from "../common/controller.js";
import { AssetParamSchema } from "../common/schemas.js";

const BINANCE_TICKER = "https://api.binance.com/api/v3/ticker/price";
const CACHE_TTL_MS = 10_000; // 10 seconds

interface BinanceTicker {
  symbol: string;
  price: string;
}

interface PriceResult {
  price: number;
  timestamp: string;
}

async function fetchBinancePrice(asset: string): Promise<PriceResult> {
  const symbol = `${asset}USDT`;
  const res = await fetch(`${BINANCE_TICKER}?symbol=${symbol}`);
  if (!res.ok) {
    throw new Error(`Binance API error: ${res.status}`);
  }
  const data = (await res.json()) as BinanceTicker;
  return {
    price: parseFloat(data.price),
    timestamp: new Date().toISOString(),
  };
}

const route = describeRoute({
  summary: "Get current asset price",
  description: "Returns the current price from Binance (cached 10s in Redis)",
  tags: ["Price"],
  responses: {
    200: { description: "Current price" },
    502: { description: "Failed to fetch price from upstream" },
  },
});

export const PriceController = createController({
  build: (factory) =>
    factory.createApp().get("/:asset", route, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");

      try {
        const result = await getCached(
          `price-${asset.toLowerCase()}`,
          CACHE_TTL_MS,
          () => fetchBinancePrice(asset)
        );
        return c.json({ asset, ...result });
      } catch {
        return c.json({ error: "Failed to fetch price" }, 502);
      }
    }),
});
