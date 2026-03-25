/**
 * Derivatives Structure — Collector
 *
 * Fetches BTC derivatives data from CoinGlass API v4:
 *   - Funding rates (current per-exchange + 30d history via Binance)
 *   - Open interest (current all-exchange sum + 30d hourly history via Binance)
 *   - Long/short ratio (current via Binance)
 *   - Liquidations (aggregated 8h history, all exchanges)
 *
 * Auth: CG-API-KEY header (set COINGLASS_API_KEY in .env)
 */

import { DerivativesSnapshot, TimestampedValue } from "../types.js";
import { getCached } from "../storage/cache.js";

const BASE = "https://open-api-v4.coinglass.com";

// ─── TTLs ─────────────────────────────────────────────────────────────────────

const TTL = {
  CURRENT:     5 * 60 * 1000,        //  5 min — live rates
  HISTORY_4H:  4 * 60 * 60 * 1000,   //  4h    — aligns with 4h candle close
  HISTORY_8H:  8 * 60 * 60 * 1000,   //  8h    — aligns with 8h candle / funding settlement
} as const;

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function cgGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.COINGLASS_API_KEY;
  if (!apiKey) throw new Error("COINGLASS_API_KEY is not set");

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "CG-API-KEY": apiKey },
  });

  if (!res.ok) {
    throw new Error(`CoinGlass ${path} → HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { code: string; msg: string; data: T };
  if (json.code !== "0") {
    throw new Error(`CoinGlass ${path} → code=${json.code} msg=${json.msg}`);
  }

  return json.data;
}

// ─── Response types ───────────────────────────────────────────────────────────

interface FundingExchangeRate {
  exchange: string;
  funding_rate: number;
  funding_rate_interval?: number;
}

interface FundingSymbolEntry {
  symbol: string;
  stablecoin_margin_list: FundingExchangeRate[];
  token_margin_list: FundingExchangeRate[];
}

interface OhlcEntry {
  time: number; // Unix milliseconds
  open: string;
  high: string;
  low: string;
  close: string;
}



interface LiqAggEntry {
  time: number;
  aggregated_long_liquidation_usd: number;
  aggregated_short_liquidation_usd: number;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Current funding rate: median of stablecoin-margined rates across major exchanges */
async function fetchCurrentFunding(): Promise<number> {
  const data = await getCached("funding-rate-exchange-list", TTL.CURRENT, () =>
    cgGet<FundingSymbolEntry[]>("/api/futures/funding-rate/exchange-list")
  );

  // Response is grouped by symbol — find BTC stablecoin-margined (USDT perps)
  const btc = data.find((d) => d.symbol === "BTC");
  if (!btc) {
    console.warn("      [warn] BTC not found in funding rate response");
    return 0;
  }

  const MAJOR = ["Binance", "OKX", "Bybit", "dYdX", "Hyperliquid"];
  const rates = btc.stablecoin_margin_list
    .filter((e) => MAJOR.includes(e.exchange))
    .map((e) => e.funding_rate)
    .filter((r) => typeof r === "number" && isFinite(r));

  if (rates.length === 0) {
    console.warn("      [warn] no major-exchange funding rates found");
    return btc.stablecoin_margin_list[0]?.funding_rate ?? 0;
  }

  rates.sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length % 2 !== 0 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;

  console.log(`      funding rate: ${median.toFixed(6)} (median of ${rates.length} exchanges)`);
  return median;
}

/** 30-day funding history at 8h resolution (90 points) */
async function fetchFundingHistory(): Promise<TimestampedValue[]> {
  const raw = await getCached("funding-rate-history-8h", TTL.HISTORY_8H, () =>
    cgGet<unknown>("/api/futures/funding-rate/history", {
      exchange: "Binance", symbol: "BTCUSDT", interval: "8h", limit: "90",
    })
  );
  const data: OhlcEntry[] = Array.isArray(raw) ? (raw as OhlcEntry[]) : ((raw as { list?: OhlcEntry[] }).list ?? []);
  return data.map((d) => ({
    timestamp: new Date(d.time).toISOString(),
    value: parseFloat(d.close),
  }));
}

/**
 * OI history at 4h resolution (180 points = 30d) via Binance BTCUSDT.
 * Values are in USD. "Current" is derived from the last candle to guarantee
 * the same source, contract type, and unit as the history — making percentiles meaningful.
 */
async function fetchOIWithHistory(): Promise<{ current: number; history: TimestampedValue[] }> {
  const raw = await getCached("open-interest-history-4h", TTL.HISTORY_4H, () =>
    cgGet<unknown>("/api/futures/open-interest/history", {
      exchange: "Binance", symbol: "BTCUSDT", interval: "4h", limit: "180",
    })
  );
  const data: OhlcEntry[] = Array.isArray(raw)
    ? (raw as OhlcEntry[])
    : ((raw as { list?: OhlcEntry[] }).list ?? []);
  const history = data.map((d) => ({ timestamp: new Date(d.time).toISOString(), value: parseFloat(d.close) }));
  const current = history.at(-1)?.value ?? 0;
  return { current, history };
}

/** Current L/S ratio — not available on Hobbyist plan, returns 1.0 as neutral default */
async function fetchCurrentLS(): Promise<number> {
  return 1.0;
}

/** 30-day liquidation history at 8h resolution + bias from the most recent window */
async function fetchLiquidations(): Promise<{
  current8h: number;
  bias: string;
  history: TimestampedValue[];
}> {
  const raw = await getCached("liquidation-aggregated-history-8h", TTL.HISTORY_8H, () =>
    cgGet<unknown>("/api/futures/liquidation/aggregated-history", {
      symbol: "BTC", interval: "8h", exchange_list: "Binance,OKX,Bybit,dYdX",
    })
  );
  const data: LiqAggEntry[] = Array.isArray(raw)
    ? (raw as LiqAggEntry[])
    : ((raw as { list?: LiqAggEntry[] }).list ?? []);

  // Use the second-to-last entry — the last bucket is the open (incomplete) window
  const latest = data.length >= 2 ? data[data.length - 2] : data[data.length - 1];
  const totalLatest = (latest?.aggregated_long_liquidation_usd ?? 0) + (latest?.aggregated_short_liquidation_usd ?? 0);
  const current8h = totalLatest;

  const longPct =
    totalLatest > 0 ? Math.round(((latest?.aggregated_long_liquidation_usd ?? 0) / totalLatest) * 100) : 50;
  const bias = `${longPct}% long`;

  const history: TimestampedValue[] = data.map((d) => ({
    timestamp: new Date(d.time).toISOString(),
    value: (d.aggregated_long_liquidation_usd ?? 0) + (d.aggregated_short_liquidation_usd ?? 0),
  }));

  return { current8h, bias, history };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function collect(): Promise<DerivativesSnapshot> {
  console.log("      Fetching from CoinGlass v4...");

  const [currentFunding, fundingHistory, oi, currentLS, liqData] = await Promise.all([
    fetchCurrentFunding(),
    fetchFundingHistory(),
    fetchOIWithHistory(),
    fetchCurrentLS(),
    fetchLiquidations(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    asset: "BTC",
    funding: {
      current: currentFunding,
      history1m: fundingHistory,
    },
    openInterest: {
      current: oi.current,
      history1m: oi.history,
    },
    longShortRatio: {
      current: currentLS,
    },
    liquidations: {
      current8h: liqData.current8h,
      bias: liqData.bias,
      history1m: liqData.history,
    },
  };
}
