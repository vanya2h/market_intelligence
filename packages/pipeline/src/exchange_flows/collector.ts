/**
 * Exchange Flows — Collector (Dimension 04)
 *
 * Fetches exchange balance data from CoinGlass API v4:
 *   - Historical balance chart (aggregate + per-exchange, with price)
 *   - Current balance list (per-exchange with 1d/7d/30d % changes)
 *
 * Auth: CG-API-KEY header (set COINGLASS_API_KEY in .env)
 */

import type { ExchangeFlowsSnapshot, BalancePoint, ExchangeBalance } from "./types.js";
import { getCached } from "../storage/cache.js";

const BASE = "https://open-api-v4.coinglass.com";

// Exchange balances update ~hourly on-chain; 1h TTL matches ETF cadence
const TTL_HOURLY = 1 * 60 * 60 * 1000;

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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

interface BalanceChartResponse {
  time_list: number[]; // timestamps in ms
  price_list: number[];
  data_map: Record<string, number[]>; // exchange → balance array
}

interface BalanceListEntry {
  exchange_name: string;
  total_balance: number;
  balance_change_percent_1d: number;
  balance_change_percent_7d: number;
  balance_change_percent_30d: number;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchBalanceChart(asset: "BTC" | "ETH"): Promise<BalanceChartResponse> {
  return getCached(`ef-balance-chart-${asset.toLowerCase()}`, TTL_HOURLY, () =>
    cgGet<BalanceChartResponse>("/api/exchange/balance/chart", { symbol: asset })
  );
}

async function fetchBalanceList(asset: "BTC" | "ETH"): Promise<BalanceListEntry[]> {
  return getCached(`ef-balance-list-${asset.toLowerCase()}`, TTL_HOURLY, () =>
    cgGet<BalanceListEntry[]>("/api/exchange/balance/list", { symbol: asset })
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBalanceHistory(chart: BalanceChartResponse): BalancePoint[] {
  const { time_list, price_list, data_map } = chart;
  if (!time_list || time_list.length === 0) return [];

  const points: BalancePoint[] = [];
  for (let i = 0; i < time_list.length; i++) {
    // Sum balances across all exchanges for this timestamp
    let totalBalance = 0;
    for (const balances of Object.values(data_map)) {
      totalBalance += balances[i] ?? 0;
    }
    points.push({
      timestamp: time_list[i]!,
      totalBalance,
      priceUsd: price_list[i] ?? 0,
    });
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

function parseBalanceList(raw: BalanceListEntry[]): ExchangeBalance[] {
  return raw
    .filter((e) => e.total_balance > 0)
    .map((e) => ({
      exchange: e.exchange_name,
      balance: e.total_balance,
      change1dPct: e.balance_change_percent_1d ?? 0,
      change7dPct: e.balance_change_percent_7d ?? 0,
      change30dPct: e.balance_change_percent_30d ?? 0,
    }))
    .sort((a, b) => b.balance - a.balance);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function collect(asset: "BTC" | "ETH" = "BTC"): Promise<ExchangeFlowsSnapshot> {
  console.log(`      Fetching exchange flow data from CoinGlass v4 (${asset})...`);

  const [chart, list] = await Promise.all([
    fetchBalanceChart(asset),
    fetchBalanceList(asset),
  ]);

  const balanceHistory = buildBalanceHistory(chart);
  const currentBalances = parseBalanceList(list);

  const latestPoint = balanceHistory.at(-1);
  const totalBalance = latestPoint?.totalBalance ?? currentBalances.reduce((s, e) => s + e.balance, 0);
  const priceUsd = latestPoint?.priceUsd ?? 0;

  return {
    timestamp: new Date().toISOString(),
    asset,
    balanceHistory,
    currentBalances,
    totalBalance,
    priceUsd,
  };
}
