/**
 * Derivatives Structure — Collector
 *
 * Fetches derivatives data from CoinGlass API v4 for BTC or ETH:
 *   - Funding rates (current per-exchange + 30d history via Binance)
 *   - Open interest (current all-exchange sum + 30d hourly history via Binance)
 *   - Liquidations (aggregated 8h history, all exchanges)
 *
 * Auth: CG-API-KEY header (set COINGLASS_API_KEY in .env)
 */

import { $Enums } from "../generated/prisma/client.js";
import { getCached } from "../storage/cache.js";
import { DerivativesSnapshot, TimestampedValue } from "../types.js";

const BASE = "https://open-api-v4.coinglass.com";

// ─── TTLs ─────────────────────────────────────────────────────────────────────

const TTL = {
  CURRENT: 5 * 60 * 1000, //  5 min
  HISTORY_4H: 5 * 60 * 1000, //  5 min
  HISTORY_8H: 5 * 60 * 1000, //  5 min
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

interface OIExchangeEntry {
  exchange: string;
  open_interest: number;
  open_interest_usd: number;
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

interface CoinbasePremiumEntry {
  time: number; // Unix seconds
  premium: number; // USD price difference
  premium_rate: number; // decimal (e.g. 0.000261)
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Per-exchange OI in USD for a given asset */
async function fetchOIByExchange(asset: $Enums.Asset): Promise<Map<string, number>> {
  const data = await getCached(`oi-exchange-list:${asset}`, TTL.CURRENT, () =>
    cgGet<OIExchangeEntry[]>("/api/futures/open-interest/exchange-list", { symbol: asset }),
  );
  const map = new Map<string, number>();
  for (const e of data) {
    if (typeof e.open_interest_usd === "number" && isFinite(e.open_interest_usd)) {
      map.set(e.exchange, e.open_interest_usd);
    }
  }
  return map;
}

/** Current funding rate: OI-weighted across major exchanges, falls back to median */
async function fetchCurrentFunding(asset: $Enums.Asset): Promise<number> {
  const [fundingData, oiByExchange] = await Promise.all([
    getCached("funding-rate-exchange-list", TTL.CURRENT, () =>
      cgGet<FundingSymbolEntry[]>("/api/futures/funding-rate/exchange-list"),
    ),
    fetchOIByExchange(asset),
  ]);

  const entry = fundingData.find((d) => d.symbol === asset);
  if (!entry) {
    console.warn(`      [warn] ${asset} not found in funding rate response`);
    return 0;
  }

  const MAJOR = ["Binance", "OKX", "Bybit", "dYdX", "Hyperliquid"];
  const pairs = entry.stablecoin_margin_list
    .filter((e) => MAJOR.includes(e.exchange))
    .map((e) => ({ exchange: e.exchange, rate: e.funding_rate, oi: oiByExchange.get(e.exchange) ?? 0 }))
    .filter((e) => typeof e.rate === "number" && isFinite(e.rate));

  if (pairs.length === 0) {
    console.warn("      [warn] no major-exchange funding rates found");
    return entry.stablecoin_margin_list[0]?.funding_rate ?? 0;
  }

  const totalOI = pairs.reduce((sum, e) => sum + e.oi, 0);

  if (totalOI === 0) {
    // No OI data matched — fall back to median
    const rates = pairs.map((e) => e.rate).sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    const median = rates.length % 2 !== 0 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
    console.log(`      funding rate: ${median.toFixed(6)} (median fallback, no OI data)`);
    return median;
  }

  const weighted = pairs.reduce((sum, e) => sum + e.rate * e.oi, 0) / totalOI;
  console.log(
    `      funding rate: ${weighted.toFixed(6)} (OI-weighted, ${pairs.filter((e) => e.oi > 0).length}/${pairs.length} exchanges with OI)`,
  );
  return weighted;
}

/** 30-day funding history at 8h resolution (90 points) */
async function fetchFundingHistory(asset: $Enums.Asset): Promise<TimestampedValue[]> {
  const symbol = `${asset}USDT`;
  const raw = await getCached(`funding-rate-history-8h:${asset}`, TTL.HISTORY_8H, () =>
    cgGet<unknown>("/api/futures/funding-rate/history", {
      exchange: "Binance",
      symbol,
      interval: "8h",
      limit: "90",
    }),
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
async function fetchOIWithHistory(asset: $Enums.Asset): Promise<{ current: number; history: TimestampedValue[] }> {
  const symbol = `${asset}USDT`;
  const raw = await getCached(`open-interest-history-4h:${asset}`, TTL.HISTORY_4H, () =>
    cgGet<unknown>("/api/futures/open-interest/history", {
      exchange: "Binance",
      symbol,
      interval: "4h",
      limit: "180",
    }),
  );
  const data: OhlcEntry[] = Array.isArray(raw) ? (raw as OhlcEntry[]) : ((raw as { list?: OhlcEntry[] }).list ?? []);
  const history = data.map((d) => ({ timestamp: new Date(d.time).toISOString(), value: parseFloat(d.close) }));
  const current = history.at(-1)?.value ?? 0;
  return { current, history };
}

/** 30-day Coinbase premium history at 1h resolution + current value */
async function fetchCoinbasePremium(asset: $Enums.Asset): Promise<{ current: number; history1m: TimestampedValue[] }> {
  const raw = await getCached(`coinbase-premium-index-4h:${asset}`, TTL.HISTORY_4H, () =>
    cgGet<CoinbasePremiumEntry[]>("/api/coinbase-premium-index", {
      symbol: asset,
      interval: "4h",
      limit: "180",
    }),
  );
  const data = Array.isArray(raw) ? raw : [];
  const history: TimestampedValue[] = data.map((d) => ({
    timestamp: new Date(d.time * 1000).toISOString(),
    value: d.premium_rate * 100, // store as %, e.g. 0.000261 → 0.0261
  }));
  const current = history.at(-1)?.value ?? 0;
  return { current, history1m: history };
}

/**
 * Futures close-price history at 4h resolution (180 pts = 30d).
 * Used to compute priceReturn24h / priceReturn7d for positioning logic.
 * Returns null if the endpoint is unavailable — analyzer degrades gracefully.
 */
async function fetchPriceHistory(asset: $Enums.Asset): Promise<TimestampedValue[] | null> {
  try {
    const symbol = `${asset}USDT`;
    const raw = await getCached(`price-candle-4h:${asset}`, TTL.HISTORY_4H, () =>
      cgGet<unknown>("/api/futures/candle", {
        exchange: "Binance",
        symbol,
        interval: "4h",
        limit: "180",
      }),
    );
    const data: OhlcEntry[] = Array.isArray(raw) ? (raw as OhlcEntry[]) : ((raw as { list?: OhlcEntry[] }).list ?? []);
    if (data.length === 0) return null;
    return data.map((d) => ({
      timestamp: new Date(d.time).toISOString(),
      value: parseFloat(d.close),
    }));
  } catch {
    return null;
  }
}

/** 90-day liquidation history at 8h resolution (270 pts) + bias from most recent window.
 *  The extended window is required for liqPct3m (percentile vs 90d history). */
async function fetchLiquidations(asset: $Enums.Asset): Promise<{
  current8h: number;
  bias: string;
  history: TimestampedValue[];
}> {
  const raw = await getCached(`liquidation-aggregated-history-8h-270:${asset}`, TTL.HISTORY_8H, () =>
    cgGet<unknown>("/api/futures/liquidation/aggregated-history", {
      symbol: asset,
      interval: "8h",
      exchange_list: "Binance,OKX,Bybit,dYdX",
      limit: "270",
    }),
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

export async function collect(asset: $Enums.Asset): Promise<DerivativesSnapshot> {
  console.log(`      Fetching ${asset} from CoinGlass v4...`);

  const [currentFunding, fundingHistory, oi, liqData, cbPremium, priceHistory] = await Promise.all([
    fetchCurrentFunding(asset),
    fetchFundingHistory(asset),
    fetchOIWithHistory(asset),
    fetchLiquidations(asset),
    fetchCoinbasePremium(asset),
    fetchPriceHistory(asset),
  ]);

  return {
    timestamp: new Date().toISOString(),
    asset,
    funding: {
      current: currentFunding,
      history1m: fundingHistory,
    },
    openInterest: {
      current: oi.current,
      history1m: oi.history,
    },
    liquidations: {
      current8h: liqData.current8h,
      bias: liqData.bias,
      history1m: liqData.history,
    },
    coinbasePremium: cbPremium,
    price: priceHistory ? { history: priceHistory } : null,
  };
}
