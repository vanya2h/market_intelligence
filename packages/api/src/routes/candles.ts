/**
 * OHLCV Candles Endpoint
 *
 * Serves 1H spot candles from Binance for a given asset, filtered to candles
 * at or after a `since` timestamp. Used by the web dashboard to render the
 * candlestick backdrop behind the trade idea returns curve.
 *
 * Candles are cached 5 minutes per asset — concurrent requests share one fetch.
 */

import { getCached } from "@market-intel/pipeline";
import { describeRoute, validator } from "hono-openapi";
import { z } from "zod";
import { createController } from "../common/controller.js";
import { AssetParamSchema } from "../common/schemas.js";

const BINANCE_SPOT = "https://api.binance.com";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface OhlcvCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

async function fetchBinanceCandles(asset: string, interval: string, since: number): Promise<OhlcvCandle[]> {
  const url = new URL(`${BINANCE_SPOT}/api/v3/klines`);
  url.searchParams.set("symbol", `${asset}USDT`);
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(since));
  url.searchParams.set("limit", "1000");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);

  const raw = (await res.json()) as BinanceKline[];
  return raw.map((k) => ({
    time: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

const SinceQuerySchema = z.object({
  since: z.coerce.number().int().positive(),
  interval: z.enum(["15m", "1h", "4h", "1d"]).optional().default("15m"),
});

const route = describeRoute({
  summary: "Get 1H OHLCV candles",
  description: "Returns 1H spot candles from Binance for the given asset since a timestamp",
  tags: ["Candles"],
  responses: {
    200: { description: "Array of 1H OHLCV candles" },
    400: { description: "Invalid parameters" },
    502: { description: "Upstream Binance error" },
  },
});

export const CandlesController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get("/:asset", route, validator("param", AssetParamSchema), validator("query", SinceQuerySchema), async (c) => {
        const { asset } = c.req.valid("param");
        const { since, interval } = c.req.valid("query");

        try {
          const candles = await getCached(`candles:${interval}:${asset.toLowerCase()}:${since}`, CACHE_TTL_MS, () =>
            fetchBinanceCandles(asset, interval, since),
          );
          return c.json({ candles });
        } catch {
          return c.json({ error: "Failed to fetch candles" }, 502);
        }
      }),
});
