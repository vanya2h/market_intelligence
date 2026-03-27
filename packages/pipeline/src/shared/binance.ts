/**
 * Shared Binance Candle Fetcher
 *
 * Lightweight kline fetcher for the outcome checker and other consumers
 * that need historical candles without the HTF collector's caching layer.
 */

import { $Enums } from "../generated/prisma/client.js";
import type { Candle } from "../htf/types.js";

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

/**
 * Fetch spot candles from Binance starting at a given timestamp.
 * Returns up to `limit` candles (max 1000 per Binance API).
 */
export async function fetchCandlesSince(
  asset: $Enums.Asset,
  interval: "4h" | "1h" | "1d",
  startTime: number,
  limit = 500,
): Promise<Candle[]> {
  const url = new URL(`${BINANCE_SPOT}/api/v3/klines`);
  url.searchParams.set("symbol", binanceSymbol(asset));
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("limit", String(Math.min(limit, 1000)));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Binance klines ${interval} → HTTP ${res.status}: ${await res.text()}`);
  }

  const raw = (await res.json()) as BinanceKline[];
  return parseKlines(raw);
}
