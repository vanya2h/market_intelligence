/**
 * HTF Technical Structure — Collector (Dimension 07)
 *
 * Fetches OHLCV candles from Binance public API (no auth required):
 *   - 300 4h candles    → SMA 50/200 on 4h, 4h RSI-14
 *   - 104 daily candles → daily RSI-14, market structure (HH/HL/LH/LL)
 *
 * Timeframe rationale: designed for traders operating on 1h/4h charts.
 * Daily = HTF trend reference. 4h = execution timeframe context.
 */

import { Candle, HtfSnapshot } from "./types.js";
import { getCached } from "../storage/cache.js";

const BINANCE_SPOT    = "https://api.binance.com";
const BINANCE_FUTURES = "https://fapi.binance.com";

const TTL = {
  H4:    5 * 60 * 1000,  // 5 min
  DAILY: 5 * 60 * 1000,  // 5 min
} as const;

// Binance kline tuple indices
const K_OPEN_TIME     = 0;
const K_OPEN          = 1;
const K_HIGH          = 2;
const K_LOW           = 3;
const K_CLOSE         = 4;
const K_VOL           = 5;
const K_TAKER_BUY_VOL = 9;

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

async function fetchKlines(
  baseUrl: string,
  apiPath: string,
  symbol: string,
  interval: string,
  limit: number,
  cacheKey: string,
  ttl: number
): Promise<Candle[]> {
  const raw = await getCached(cacheKey, ttl, async () => {
    const url = new URL(`${baseUrl}${apiPath}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Binance klines ${interval} → HTTP ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as BinanceKline[];
  });

  return raw.map((k) => ({
    time:           k[K_OPEN_TIME] as number,
    open:           parseFloat(k[K_OPEN]  as string),
    high:           parseFloat(k[K_HIGH]  as string),
    low:            parseFloat(k[K_LOW]   as string),
    close:          parseFloat(k[K_CLOSE] as string),
    volume:         parseFloat(k[K_VOL]   as string),
    takerBuyVolume: parseFloat(k[K_TAKER_BUY_VOL] as string),
  }));
}

function binanceSymbol(asset: "BTC" | "ETH"): string {
  return `${asset}USDT`;
}

export async function collect(asset: "BTC" | "ETH" = "BTC"): Promise<HtfSnapshot> {
  console.log(`      Fetching OHLCV from Binance (${asset})...`);
  const symbol = binanceSymbol(asset);

  const [h4Candles, dailyCandles, futuresH4Candles] = await Promise.all([
    fetchKlines(BINANCE_SPOT,    "/api/v3/klines",  symbol, "4h",  300, `htf-4h-${asset.toLowerCase()}`,          TTL.H4),
    fetchKlines(BINANCE_SPOT,    "/api/v3/klines",  symbol, "1d",  104, `htf-daily-${asset.toLowerCase()}`,       TTL.DAILY),
    fetchKlines(BINANCE_FUTURES, "/fapi/v1/klines", symbol, "4h",  750, `htf-futures-4h-750-${asset.toLowerCase()}`,  TTL.H4),
  ]);

  console.log(`      ${h4Candles.length} × 4h spot · ${futuresH4Candles.length} × 4h futures · ${dailyCandles.length} × 1d candles`);

  return {
    timestamp: new Date().toISOString(),
    asset,
    h4Candles,
    dailyCandles,
    futuresH4Candles,
  };
}
