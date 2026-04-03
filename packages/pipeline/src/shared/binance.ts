/**
 * Shared Binance Candle Fetcher
 *
 * Lightweight kline fetcher for the outcome checker and other consumers
 * that need historical candles without the HTF collector's caching layer.
 */

import type { $Enums } from "../generated/prisma/client.js";
import type { Candle } from "../htf/types.js";
import { getCached } from "../storage/cache.js";

const BINANCE_SPOT = "https://api.binance.com";

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

const K_OPEN_TIME = 0;
const K_OPEN = 1;
const K_HIGH = 2;
const K_LOW = 3;
const K_CLOSE = 4;
const K_VOL = 5;
const K_TAKER_BUY_VOL = 9;

function binanceSymbol(asset: $Enums.Asset): string {
  return `${asset}USDT`;
}

function parseKlines(raw: BinanceKline[]): Candle[] {
  return raw.map((k) => ({
    time: k[K_OPEN_TIME] as number,
    open: parseFloat(k[K_OPEN] as string),
    high: parseFloat(k[K_HIGH] as string),
    low: parseFloat(k[K_LOW] as string),
    close: parseFloat(k[K_CLOSE] as string),
    volume: parseFloat(k[K_VOL] as string),
    takerBuyVolume: parseFloat(k[K_TAKER_BUY_VOL] as string),
  }));
}

// Cache 1000 most recent candles per asset+interval for 5 minutes.
// All callers (including concurrent outcome checker runs) share one entry.
const CANDLES_TTL_MS = 5 * 60 * 1000;
const CANDLES_FETCH_LIMIT = 1000;

/**
 * Fetch spot candles from Binance starting at a given timestamp.
 * Candles are cached per asset+interval; startTime filters from the cached set.
 * Returns up to `limit` candles after startTime (default 500).
 */
export async function fetchCandlesSince(
  asset: $Enums.Asset,
  interval: "4h" | "1h" | "1d",
  startTime: number,
  limit = 500,
): Promise<Candle[]> {
  const cacheKey = `binance:klines:${asset.toLowerCase()}:${interval}`;

  const all = await getCached(cacheKey, CANDLES_TTL_MS, async () => {
    const url = new URL(`${BINANCE_SPOT}/api/v3/klines`);
    url.searchParams.set("symbol", binanceSymbol(asset));
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(CANDLES_FETCH_LIMIT));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Binance klines ${interval} → HTTP ${res.status}: ${await res.text()}`);
    }

    return parseKlines((await res.json()) as BinanceKline[]);
  });

  return all.filter((c) => c.time >= startTime).slice(0, limit);
}
