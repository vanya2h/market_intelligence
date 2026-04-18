/**
 * Market Sentiment — Collector (Dimension 06)
 *
 * Fetches from three source types:
 *   1. unbias API: accuracy-weighted analyst consensus (BTC, ETH)
 *   2. Alternative.me: Fear & Greed index (market-wide)
 *   3. Cross-dimension: pulls cached data from Dim 01, 03, 07
 *      to compute our own composite Fear & Greed index
 *
 * Auth: X-API-Key header for unbias (set UNBIAS_API_KEY in .env)
 * Alternative.me requires no auth.
 */

import fs from "node:fs";
import path from "node:path";
import { analyze as analyzeDerivatives } from "../derivatives_structure/analyzer.js";
import { collect as collectDerivatives } from "../derivatives_structure/collector.js";
import { analyze as analyzeEtfs } from "../etfs/analyzer.js";
import { collect as collectEtfs } from "../etfs/collector.js";
import type { EtfState } from "../etfs/types.js";
import { analyze as analyzeExchangeFlows } from "../exchange_flows/analyzer.js";
import { collect as collectExchangeFlows } from "../exchange_flows/collector.js";
import type { ExchangeFlowsState } from "../exchange_flows/types.js";
import { analyze as analyzeHtf } from "../htf/analyzer.js";
import { collect as collectHtf } from "../htf/collector.js";
import type { Candle, HtfState } from "../htf/types.js";
import { getCached } from "../storage/cache.js";
import type { AssetType } from "../types.js";
import type { DerivativesState } from "../types.js";
import { CrossDimensionInputs, SentimentSnapshot, UnbiasConsensusEntry } from "./types.js";

const TTL_CONSENSUS = 5 * 60 * 1000;

// ─── unbias API ──────────────────────────────────────────────────────────────

interface UnbiasConsensusRaw {
  date: string;
  consensus_index: number;
  consensus_index_30d_ma: number;
  z_score: number;
  avg_sentiment_score: number;
  bullish_analysts: number;
  bearish_analysts: number;
  total_analysts: number;
  bullish_opinions: number;
  bearish_opinions: number;
  total_opinions: number;
}

async function fetchConsensus(asset: AssetType): Promise<UnbiasConsensusEntry[]> {
  const apiKey = process.env.UNBIAS_API_KEY;
  if (!apiKey) throw new Error("UNBIAS_API_KEY is not set");

  const url = new URL("https://unbias.fyi/api/v1/consensus");
  url.searchParams.set("asset", asset);
  url.searchParams.set("days", "7");

  const data = await getCached(`sentiment-consensus-${asset.toLowerCase()}`, TTL_CONSENSUS, async () => {
    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
    });

    if (!res.ok) {
      throw new Error(`unbias /api/v1/consensus → HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    // Free tier returns a single object; Pro returns an array
    return Array.isArray(json) ? (json as UnbiasConsensusRaw[]) : [json as UnbiasConsensusRaw];
  });

  return data.map((d) => ({
    date: d.date,
    consensusIndex: d.consensus_index,
    consensusIndex30dMa: d.consensus_index_30d_ma,
    zScore: d.z_score,
    avgSentimentScore: d.avg_sentiment_score ?? 0,
    bullishAnalysts: d.bullish_analysts,
    bearishAnalysts: d.bearish_analysts,
    totalAnalysts: d.total_analysts,
    bullishOpinions: d.bullish_opinions,
    bearishOpinions: d.bearish_opinions,
    totalOpinions: d.total_opinions,
  }));
}

// ─── Cross-dimension data ────────────────────────────────────────────────────

function loadDimState<T>(file: string, asset: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  // Some state files are keyed by asset, others are a single object
  return (all[asset] ?? all) as T;
}

async function fetchCrossDimensions(asset: AssetType): Promise<CrossDimensionInputs> {
  const inputs: CrossDimensionInputs = {
    derivatives: null,
    etfs: null,
    htf: null,
    exchangeFlows: null,
  };

  // Derivatives
  try {
    const snapshot = await collectDerivatives(asset);
    const prevState = loadDimState<DerivativesState>("derivatives_state.json", asset);
    const { context } = analyzeDerivatives(snapshot, prevState);
    inputs.derivatives = {
      fundingPercentile1m: context.funding.percentile["1m"],
      oiPercentile1m: context.openInterest.percentile["1m"],
      cbPremiumPercentile1m: context.coinbasePremium.percentile["1m"],
      liqPercentile1m: context.liquidations.percentile["1m"],
      liqLongPct: parseInt(context.liquidations.bias, 10) || 50,
      regime: `${context.positioning.state}|${context.stress.state}`,
    };
  } catch (e) {
    console.log(`      ⚠ Derivatives data unavailable: ${(e as Error).message}`);
  }

  // ETFs
  try {
    const snapshot = await collectEtfs(asset);
    const prevState = loadDimState<EtfState>("etfs_state.json", asset);
    const { context } = analyzeEtfs(snapshot, prevState);
    inputs.etfs = {
      consecutiveInflowDays: context.flow.consecutiveInflowDays,
      consecutiveOutflowDays: context.flow.consecutiveOutflowDays,
      todaySigma: context.flow.todaySigma,
      regime: context.regime,
    };
  } catch (e) {
    console.log(`      ⚠ ETF data unavailable: ${(e as Error).message}`);
  }

  // HTF
  try {
    const snapshot = await collectHtf(asset);
    const prevState = loadDimState<HtfState>("htf_state.json", asset);
    const { context } = analyzeHtf(snapshot, prevState);
    // Compute ATR ratio (current daily vs 30d-ago daily) for volatility compression
    const dailyCandles = snapshot.dailyCandles;
    let atrRatio = 1;
    if (dailyCandles.length >= 44) {
      const computeDailyAtr14 = (candles: Candle[]): number => {
        if (candles.length < 15) return 0;
        const trs: number[] = [];
        for (let i = 1; i < candles.length; i++) {
          const c = candles[i]!;
          const pc = candles[i - 1]!.close;
          trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
        }
        let atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
        for (let i = 14; i < trs.length; i++) {
          atr = (atr * 13 + trs[i]!) / 14;
        }
        return atr;
      };

      const currentAtr = computeDailyAtr14(dailyCandles);
      const olderAtr = computeDailyAtr14(dailyCandles.slice(0, -30));
      if (olderAtr > 0 && currentAtr > 0) {
        atrRatio = parseFloat((currentAtr / olderAtr).toFixed(3));
      }
    }

    inputs.htf = {
      priceVsSma50Pct: context.ma.priceVsSma50Pct,
      priceVsSma200Pct: context.ma.priceVsSma200Pct,
      dailyRsi: context.rsi.daily,
      h4Rsi: context.rsi.h4,
      structure: context.structure,
      regime: context.regime,
      atr: context.atr,
      atrRatio,
      cvdDivergence: context.cvd.futures.divergence,
    };
  } catch (e) {
    console.log(`      ⚠ HTF data unavailable: ${(e as Error).message}`);
  }

  // Exchange Flows
  try {
    const snapshot = await collectExchangeFlows(asset);
    const prevState = loadDimState<ExchangeFlowsState>("exchange_flows_state.json", asset);
    const { context } = analyzeExchangeFlows(snapshot, prevState);
    inputs.exchangeFlows = {
      reserveChange7dPct: context.metrics.reserveChange7dPct,
      reserveChange30dPct: context.metrics.reserveChange30dPct,
      balanceTrend: context.metrics.balanceTrend,
      todaySigma: context.metrics.todaySigma,
      isAt30dLow: context.metrics.isAt30dLow,
      isAt30dHigh: context.metrics.isAt30dHigh,
      regime: context.regime,
    };
  } catch (e) {
    console.log(`      ⚠ Exchange flows data unavailable: ${(e as Error).message}`);
  }

  return inputs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function collect(asset: AssetType = "BTC"): Promise<SentimentSnapshot> {
  console.log(`      Fetching sentiment data (${asset})...`);

  // Expert consensus (unbias API) excluded while collecting more data — re-enable later
  // const [consensus, crossDimensions] = await Promise.all([
  //   fetchConsensus(asset),
  //   fetchCrossDimensions(asset),
  // ]);
  const crossDimensions = await fetchCrossDimensions(asset);

  return {
    timestamp: new Date().toISOString(),
    asset,
    consensus: [], // was: consensus
    crossDimensions,
  };
}
