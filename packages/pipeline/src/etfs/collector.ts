/**
 * ETF Flows — Collector (Dimension 03)
 *
 * Fetches BTC/ETH spot ETF data from CoinGlass API v4:
 *   - Daily flow history (all US ETFs aggregated)
 *   - Total AUM snapshot
 *   - GBTC premium/discount (BTC only, via Grayscale holdings list)
 *
 * Auth: CG-API-KEY header (set COINGLASS_API_KEY in .env)
 */

import { EtfFlowDay, EtfSnapshot } from "./types.js";
import { getCached } from "../storage/cache.js";

const BASE = "https://open-api-v4.coinglass.com";

const TTL_DAILY = 5 * 60 * 1000;

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

interface FlowHistoryEntry {
  timestamp: number; // ms
  flow_usd: number;
  price_usd: number;
  etf_flows: { etf_ticker: string; flow_usd: number }[];
}

interface BtcListEntry {
  ticker: string;
  aum_usd: string;
}

interface EthNetAssetsEntry {
  net_assets_usd: number;
  timestamp: number;
}

interface GrayscaleEntry {
  symbol: string;
  premium_rate: number;
  holdings_amount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFlowHistory(raw: FlowHistoryEntry[]): EtfFlowDay[] {
  return raw.map((d) => ({
    date: new Date(d.timestamp).toISOString().slice(0, 10),
    flowUsd: d.flow_usd,
    priceUsd: d.price_usd,
    perEtf: (d.etf_flows ?? []).map((e) => ({ ticker: e.etf_ticker, flowUsd: e.flow_usd })),
  }));
}

// ─── BTC fetchers ─────────────────────────────────────────────────────────────

async function fetchBtcFlowHistory(): Promise<EtfFlowDay[]> {
  const data = await getCached("etf-btc-flow-history", TTL_DAILY, () =>
    cgGet<FlowHistoryEntry[]>("/api/etf/bitcoin/flow-history")
  );
  return parseFlowHistory(data);
}

async function fetchBtcTotalAum(): Promise<number> {
  const data = await getCached("etf-btc-list", TTL_DAILY, () =>
    cgGet<BtcListEntry[]>("/api/etf/bitcoin/list")
  );
  return data.reduce((sum, e) => sum + (parseFloat(e.aum_usd) || 0), 0);
}

async function fetchGbtcData(): Promise<{ premiumRate: number; holdingsBtc: number }> {
  const data = await getCached("grayscale-holdings-list", TTL_DAILY, () =>
    cgGet<GrayscaleEntry[]>("/api/grayscale/holdings-list")
  );
  const gbtc = data.find((e) => e.symbol === "BTC");
  if (!gbtc) return { premiumRate: 0, holdingsBtc: 0 };
  return { premiumRate: gbtc.premium_rate, holdingsBtc: gbtc.holdings_amount };
}

// ─── ETH fetchers ─────────────────────────────────────────────────────────────

async function fetchEthFlowHistory(): Promise<EtfFlowDay[]> {
  const data = await getCached("etf-eth-flow-history", TTL_DAILY, () =>
    cgGet<FlowHistoryEntry[]>("/api/etf/ethereum/flow-history")
  );
  return parseFlowHistory(data);
}

async function fetchEthTotalAum(): Promise<number> {
  const data = await getCached("etf-eth-net-assets", TTL_DAILY, () =>
    cgGet<EthNetAssetsEntry[]>("/api/etf/ethereum/net-assets/history")
  );
  return data.at(-1)?.net_assets_usd ?? 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function collect(asset: "BTC" | "ETH" = "BTC"): Promise<EtfSnapshot> {
  console.log(`      Fetching ETF data from CoinGlass v4 (${asset})...`);

  if (asset === "ETH") {
    const [flowHistory, totalAumUsd] = await Promise.all([
      fetchEthFlowHistory(),
      fetchEthTotalAum(),
    ]);
    return { timestamp: new Date().toISOString(), asset: "ETH", flowHistory, totalAumUsd };
  }

  const [flowHistory, totalAumUsd, gbtc] = await Promise.all([
    fetchBtcFlowHistory(),
    fetchBtcTotalAum(),
    fetchGbtcData(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    asset: "BTC",
    flowHistory,
    totalAumUsd,
    gbtcPremiumRate: gbtc.premiumRate,
    gbtcHoldingsBtc: gbtc.holdingsBtc,
  };
}
