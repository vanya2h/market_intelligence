/**
 * Debug Brief — Writes a full inspection of a brief run to tmp/debug-brief/<briefId>/
 *
 * Files written:
 *   00-run.txt                NotifyRun metadata, status, delta summary, tweet text
 *   01-overview.txt           Brief overview + previous brief comparison
 *   02-dim-derivatives.txt    Derivatives dimension analysis
 *   03-dim-etfs.txt           ETF flows analysis
 *   04-dim-htf.txt            HTF technical analysis
 *   05-dim-sentiment.txt      Sentiment analysis
 *   06-dim-exchange-flows.txt Exchange flows analysis
 *   07-regimes.txt            Regime summary table with flips
 *   08-confluence.txt         Confluence scoring + bias (reconstructed)
 *   09-trade-idea.txt         Trade idea, levels, outcome returns
 *   10-rich-brief.txt         Rich brief blocks (infographic content)
 *   11-brief-text.txt         Final synthesized brief text (clean)
 *   12-llm-system-prompt.txt  System prompt sent to the synthesizer LLM
 *   13-llm-user-prompt.txt    User prompt sent to the synthesizer LLM
 *   raw-context.json          Raw dimension contexts (full JSON)
 *
 * Usage:
 *   tsx src/scripts/debug-brief.ts [BTC|ETH]          # latest completed run
 *   tsx src/scripts/debug-brief.ts --run <runId>       # specific NotifyRun
 *   tsx src/scripts/debug-brief.ts --brief <briefId>   # specific Brief
 */

import "../env.js";
import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { prisma } from "../storage/db.js";
import {
  type DimensionOutput,
  type DerivativesOutput,
  type EtfsOutput,
  type HtfOutput,
  type SentimentOutput,
  type ExchangeFlowsOutput,
} from "../orchestrator/types.js";
import { computeConfluence, CONVICTION_THRESHOLD, type Confluence } from "../orchestrator/trade-idea/confluence.js";
import { computeBias } from "../orchestrator/trade-idea/bias.js";
import type { DirectionalBias } from "../orchestrator/trade-idea/bias.js";
import type { RunArtifacts } from "../orchestrator/notify-run.js";
import type { Direction } from "../orchestrator/trade-idea/composite-target.js";
import type { TradeDecision } from "../orchestrator/trade-idea/index.js";
import type { DeltaSummary } from "../orchestrator/delta.js";
import { buildPrompt, buildSystemPrompt } from "../orchestrator/synthesizer.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = nodePath.resolve(__dirname, "../../../../");
const DEBUG_BASE = nodePath.join(REPO_ROOT, "tmp", "debug-brief");

// ─── Formatting helpers (plain text, no ANSI) ─────────────────────────────────

function sep(char = "═", width = 60): string {
  return char.repeat(width);
}

function section(title: string): string {
  return `\n${sep()}\n${title}\n${sep()}\n\n`;
}

function subsection(title: string): string {
  return `\n${title}\n${sep("─", 40)}\n`;
}

function kv(label: string, value: string | number | null | undefined, indent = 0): string {
  const pad = " ".repeat(indent);
  const v = value == null ? "—" : String(value);
  return `${pad}${label}: ${v}\n`;
}

function pct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function num(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function price(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ago(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

// ─── File writer ──────────────────────────────────────────────────────────────

function write(dir: string, filename: string, content: string): void {
  fs.writeFileSync(nodePath.join(dir, filename), content.trimEnd() + "\n", "utf8");
  const kb = (Buffer.byteLength(content, "utf8") / 1024).toFixed(1);
  console.log(`  ${chalk.cyan(filename.padEnd(30))} ${chalk.dim(`${kb}KB`)}`);
}

// ─── Resolve target ───────────────────────────────────────────────────────────

interface ResolvedIds {
  runId: string | null;
  briefId: string;
  asset: string;
}

async function resolveTarget(): Promise<ResolvedIds> {
  const args = process.argv.slice(2);

  const runIdx = args.indexOf("--run");
  if (runIdx !== -1 && args[runIdx + 1]) {
    const run = await prisma.notifyRun.findUniqueOrThrow({ where: { id: args[runIdx + 1] } });
    if (!run.briefId) throw new Error(`NotifyRun ${run.id} has no briefId — not past PERSIST stage`);
    return { runId: run.id, briefId: run.briefId, asset: run.asset };
  }

  const briefIdx = args.indexOf("--brief");
  if (briefIdx !== -1 && args[briefIdx + 1]) {
    const brief = await prisma.brief.findUniqueOrThrow({ where: { id: args[briefIdx + 1] }, select: { id: true, asset: true } });
    const run = await prisma.notifyRun.findFirst({ where: { briefId: brief.id }, select: { id: true } });
    return { runId: run?.id ?? null, briefId: brief.id, asset: brief.asset };
  }

  const asset = (args[0]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  const run = await prisma.notifyRun.findFirst({
    where: { asset, status: "COMPLETED", briefId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (run?.briefId) return { runId: run.id, briefId: run.briefId, asset };

  const brief = await prisma.brief.findFirstOrThrow({
    where: { asset },
    orderBy: { timestamp: "desc" },
    select: { id: true, asset: true },
  });
  return { runId: null, briefId: brief.id, asset: brief.asset };
}

// ─── Section builders ─────────────────────────────────────────────────────────

type NotifyRun = NonNullable<Awaited<ReturnType<typeof prisma.notifyRun.findUnique>>>;

function buildRun(run: NotifyRun, artifacts: RunArtifacts): string {
  let out = section("NOTIFY RUN");

  out += kv("Run ID", run.id);
  out += kv("Status", run.status);
  out += kv("Created", `${run.createdAt.toISOString()} (${ago(run.createdAt)})`);
  out += kv("Updated", `${run.updatedAt.toISOString()} (${ago(run.updatedAt)})`);
  out += kv("Duration", `${((run.updatedAt.getTime() - run.createdAt.getTime()) / 1000).toFixed(1)}s`);
  out += kv("Last Completed Stage", run.lastCompleted);
  if (run.failedStage) out += kv("Failed Stage", run.failedStage);
  if (run.error) out += kv("Error", run.error);
  if (artifacts.briefUrl) out += kv("Brief URL", artifacts.briefUrl);

  if (artifacts.deltaSummary) {
    const ds = artifacts.deltaSummary;
    out += subsection("Delta Summary");
    out += kv("Tier", ds.tier.toUpperCase());
    out += kv("Max Z-Score", ds.maxZ === Infinity ? "∞ (first run)" : num(ds.maxZ, 3));
    if (ds.changeSummary) {
      out += "Change Summary:\n";
      for (const line of ds.changeSummary.split("\n")) {
        out += `  ${line}\n`;
      }
    }
    if (ds.dimensions?.length) {
      out += "\nDimension Deltas:\n";
      for (const dim of ds.dimensions) {
        const regimeChange = dim.regimeFlipped
          ? `${dim.prevRegime} → ${dim.currRegime} [FLIP]`
          : dim.currRegime;
        out += `\n${dim.dimension}: ${regimeChange}\n`;
        if (dim.topMovers?.length) {
          for (const m of dim.topMovers) {
            const dir = m.delta > 0 ? "↑" : "↓";
            out += `  ${m.label}: ${num(m.prev)} → ${num(m.curr)} ${dir}  z=${num(m.zScore, 3)}  σ=${num(m.sigma, 4)}\n`;
          }
        }
      }
    }
  }

  if (artifacts.tweetText) {
    out += subsection("Tweet Text");
    out += artifacts.tweetText + "\n";
    out += `\n(${artifacts.tweetText.length} chars)\n`;
  }

  return out;
}

function buildOverview(
  brief: { id: string; timestamp: Date; dimensions: string[]; brief: string; richBrief: unknown },
  prevBrief: {
    id: string;
    timestamp: Date;
    derivatives: { regime: string } | null;
    etfs: { regime: string } | null;
    htf: { regime: string; snapshotPrice: number | null } | null;
    sentiment: { regime: string; compositeIndex: number | null } | null;
    exchangeFlows: { regime: string } | null;
  } | null,
): string {
  let out = section("BRIEF OVERVIEW");

  out += kv("Brief ID", brief.id);
  out += kv("Timestamp", `${brief.timestamp.toISOString()} (${ago(brief.timestamp)})`);
  out += kv("Dimensions", brief.dimensions.join(", "));
  out += kv("Brief Length", `${brief.brief.length} chars, ${brief.brief.split(/\s+/).length} words`);
  out += kv("Rich Brief", brief.richBrief ? `${(brief.richBrief as { blocks: unknown[] }).blocks?.length ?? "?"} blocks` : "none");

  if (prevBrief) {
    out += subsection("Previous Brief (delta reference)");
    out += kv("ID", prevBrief.id);
    out += kv("Timestamp", `${prevBrief.timestamp.toISOString()} (${ago(prevBrief.timestamp)})`);
    const prevRegimes = [
      prevBrief.derivatives?.regime,
      prevBrief.etfs?.regime,
      prevBrief.htf?.regime,
      prevBrief.sentiment?.regime,
      prevBrief.exchangeFlows?.regime,
    ].filter(Boolean).join(", ");
    out += kv("Regimes", prevRegimes);
    if (prevBrief.htf?.snapshotPrice) out += kv("Snapshot Price", price(prevBrief.htf.snapshotPrice));
    if (prevBrief.sentiment?.compositeIndex != null) out += kv("F&G Index", num(prevBrief.sentiment.compositeIndex));
  }

  return out;
}

function buildDimDerivatives(d: {
  regime: string; previousRegime: string | null; stress: string | null; previousStress: string | null;
  oiSignal: string | null; since: Date; context: unknown; interpretation: string;
}): string {
  let out = section("DERIVATIVES STRUCTURE");

  out += kv("Regime", d.regime);
  out += kv("Previous Regime", d.previousRegime);
  out += kv("Stress", d.stress);
  out += kv("Previous Stress", d.previousStress);
  out += kv("OI Signal", d.oiSignal);
  out += kv("Since", d.since.toISOString());

  const ctx = d.context as Record<string, unknown>;
  const signals = ctx.signals as Record<string, unknown> | undefined;
  const funding = ctx.funding as Record<string, unknown> | undefined;
  const oi = ctx.openInterest as Record<string, unknown> | undefined;
  const cbPremium = ctx.coinbasePremium as Record<string, unknown> | undefined;
  const events = ctx.events as Array<Record<string, unknown>> | undefined;

  if (signals) {
    out += subsection("Key Signals");
    out += kv("Funding Pctl (1m)", num(signals.fundingPct1m as number));
    out += kv("OI Z-Score (30d)", num(signals.oiZScore30d as number));
    out += kv("OI Change (24h)", pct(signals.oiChange24h as number));
    out += kv("OI Change (7d)", pct(signals.oiChange7d as number));
    out += kv("Liq Pctl (1m)", num(signals.liqPct1m as number));
    out += kv("Price Return (24h)", pct(signals.priceReturn24h as number | null));
    out += kv("Price Return (7d)", pct(signals.priceReturn7d as number | null));
    out += kv("Funding Pressure Cycles", num(signals.fundingPressureCycles as number, 0));
  }
  if (funding) {
    out += subsection("Funding");
    out += kv("Current", num(funding.current as number, 6));
    const pctl = funding.percentile as Record<string, unknown> | undefined;
    if (pctl) out += kv("Percentile (1m)", num(pctl["1m"] as number));
  }
  if (oi) {
    out += subsection("Open Interest");
    out += kv("Current", price(oi.current as number));
    const pctl = oi.percentile as Record<string, unknown> | undefined;
    if (pctl) out += kv("Percentile (1m)", num(pctl["1m"] as number));
  }
  if (cbPremium) {
    out += subsection("Coinbase Premium");
    out += kv("Current", num(cbPremium.current as number, 4));
    const pctl = cbPremium.percentile as Record<string, unknown> | undefined;
    if (pctl) out += kv("Percentile (1m)", num(pctl["1m"] as number));
  }
  if (events?.length) {
    out += subsection("Events");
    for (const e of events) {
      out += `  [${e.at}] ${e.type}: ${e.detail}\n`;
    }
  }

  out += subsection("LLM Interpretation");
  out += d.interpretation + "\n";

  return out;
}

function buildDimEtfs(d: {
  regime: string; previousRegime: string | null; since: Date; context: unknown; interpretation: string;
}): string {
  let out = section("INSTITUTIONAL FLOWS (ETFs)");

  out += kv("Regime", d.regime);
  out += kv("Previous Regime", d.previousRegime);
  out += kv("Since", d.since.toISOString());

  const ctx = d.context as Record<string, unknown>;
  const flow = ctx.flow as Record<string, unknown> | undefined;

  if (flow) {
    out += subsection("Flow Data");
    out += kv("Today", price(flow.today as number));
    out += kv("Today Sigma", num(flow.todaySigma as number));
    out += kv("3d Sum", price(flow.d3Sum as number));
    out += kv("7d Sum", price(flow.d7Sum as number));
    out += kv("30d Sum", price(flow.d30Sum as number | null));
    out += kv("Percentile (1m)", num(flow.percentile1m as number));
    out += kv("Consecutive Inflow Days", num(flow.consecutiveInflowDays as number, 0));
    out += kv("Consecutive Outflow Days", num(flow.consecutiveOutflowDays as number, 0));
    out += kv("Reversal Ratio", num(flow.reversalRatio as number));
  }
  out += kv("Total AUM", price(ctx.totalAumUsd as number));

  out += subsection("LLM Interpretation");
  out += d.interpretation + "\n";

  return out;
}

function buildDimHtf(d: {
  regime: string; previousRegime: string | null; since: Date; lastStructure: string | null;
  snapshotPrice: number | null; context: unknown; interpretation: string;
}): string {
  let out = section("HTF TECHNICAL STRUCTURE");

  out += kv("Regime", d.regime);
  out += kv("Previous Regime", d.previousRegime);
  out += kv("Market Structure", d.lastStructure);
  out += kv("Snapshot Price", price(d.snapshotPrice));
  out += kv("Since", d.since.toISOString());

  const ctx = d.context as Record<string, unknown>;
  const ma = ctx.ma as Record<string, unknown> | undefined;
  const rsi = ctx.rsi as Record<string, unknown> | undefined;
  const cvd = ctx.cvd as Record<string, unknown> | undefined;
  const vol = ctx.volatility as Record<string, unknown> | undefined;
  const vp = ctx.volumeProfile as Record<string, unknown> | undefined;
  const staleness = ctx.staleness as Record<string, unknown> | undefined;

  if (ma) {
    out += subsection("Moving Averages");
    out += kv("Price vs SMA50", pct(ma.priceVsSma50Pct as number));
    out += kv("Price vs SMA200", pct(ma.priceVsSma200Pct as number));
    out += kv("SMA50", price(ma.sma50 as number));
    out += kv("SMA200", price(ma.sma200 as number));
  }
  if (rsi) {
    out += subsection("RSI");
    out += kv("Daily", num(rsi.daily as number));
    out += kv("4H", num(rsi.h4 as number));
  }
  if (cvd) {
    out += subsection("CVD Divergence");
    const futures = cvd.futures as Record<string, unknown> | undefined;
    const spot = cvd.spot as Record<string, unknown> | undefined;
    if (futures) {
      out += kv("Futures Divergence", futures.divergence as string);
      const fShort = futures.short as Record<string, unknown> | undefined;
      if (fShort) {
        out += kv("  Short Slope", num(fShort.slope as number, 4));
        out += kv("  Short R²", num(fShort.r2 as number, 4));
      }
      const fLong = futures.long as Record<string, unknown> | undefined;
      if (fLong) {
        out += kv("  Long Slope", num(fLong.slope as number, 4));
        out += kv("  Long R²", num(fLong.r2 as number, 4));
      }
    }
    if (spot) {
      out += kv("Spot Divergence", spot.divergence as string);
      const sShort = spot.short as Record<string, unknown> | undefined;
      if (sShort) {
        out += kv("  Short Slope", num(sShort.slope as number, 4));
        out += kv("  Short R²", num(sShort.r2 as number, 4));
      }
    }
  }
  if (vol) {
    out += subsection("Volatility");
    out += kv("ATR Percentile", num(vol.atrPercentile as number));
    out += kv("ATR Ratio", num(vol.atrRatio as number, 4));
    out += kv("Compression After Move", String(vol.compressionAfterMove ?? false));
    out += kv("Recent Displacement", num(vol.recentDisplacement as number));
  }
  if (vp) {
    out += subsection("Volume Profile");
    const profile = vp.profile as Record<string, unknown> | undefined;
    if (profile) {
      out += kv("POC", price(profile.poc as number));
      out += kv("Price vs POC", pct(profile.priceVsPocPct as number));
      out += kv("VWAP Weekly", price(profile.vwapWeekly as number | null));
      out += kv("VWAP Monthly", price(profile.vwapMonthly as number | null));
      out += kv("Value Area Low", price(profile.valueAreaLow as number | null));
      out += kv("Value Area High", price(profile.valueAreaHigh as number | null));
    }
  }
  if (staleness) {
    out += subsection("Signal Staleness");
    out += kv("RSI Extreme (candles ago)", num(staleness.rsiExtreme as number | null, 0));
    out += kv("CVD Divergence Peak (candles ago)", num(staleness.cvdDivergencePeak as number | null, 0));
  }

  out += subsection("LLM Interpretation");
  out += d.interpretation + "\n";

  return out;
}

function buildDimSentiment(d: {
  regime: string; previousRegime: string | null; since: Date;
  compositeIndex: number | null; compositeLabel: string | null;
  positioning: number | null; trend: number | null; institutionalFlows: number | null;
  exchangeFlows: number | null; expertConsensus: number | null;
  context: unknown; interpretation: string;
}): string {
  let out = section("MARKET SENTIMENT");

  out += kv("Regime", d.regime);
  out += kv("Previous Regime", d.previousRegime);
  out += kv("Since", d.since.toISOString());

  out += subsection("Composite Scores");
  out += kv("Composite Index", num(d.compositeIndex));
  out += kv("Composite Label", d.compositeLabel);
  out += kv("Positioning", num(d.positioning));
  out += kv("Trend", num(d.trend));
  out += kv("Institutional Flows", num(d.institutionalFlows));
  out += kv("Exchange Flows", num(d.exchangeFlows));
  out += kv("Expert Consensus", num(d.expertConsensus));

  const ctx = d.context as Record<string, unknown>;
  const metrics = ctx.metrics as Record<string, unknown> | undefined;
  if (metrics) {
    out += kv("Z-Score", num(metrics.zScore as number));
    out += kv("Bullish Ratio", num(metrics.bullishRatio as number));
  }

  out += subsection("LLM Interpretation");
  out += d.interpretation + "\n";

  return out;
}

function buildDimExchangeFlows(d: {
  regime: string; previousRegime: string | null; since: Date; context: unknown; interpretation: string;
}): string {
  let out = section("EXCHANGE FLOWS & LIQUIDITY");

  out += kv("Regime", d.regime);
  out += kv("Previous Regime", d.previousRegime);
  out += kv("Since", d.since.toISOString());

  const ctx = d.context as Record<string, unknown>;
  const metrics = ctx.metrics as Record<string, unknown> | undefined;

  if (metrics) {
    out += subsection("Flow Metrics");
    out += kv("Today Sigma", num(metrics.todaySigma as number));
    out += kv("Flow Percentile (1m)", num(metrics.flowPercentile1m as number));
    out += kv("Reserve Change (1d)", pct(metrics.reserveChange1dPct as number));
    out += kv("Reserve Change (7d)", pct(metrics.reserveChange7dPct as number));
    out += kv("Reserve Change (30d)", pct(metrics.reserveChange30dPct as number));
    out += kv("Net Flow (1d)", price(metrics.netFlow1d as number));
    out += kv("Net Flow (7d)", price(metrics.netFlow7d as number));
  }

  const balanceTrend = ctx.balanceTrend as string | undefined;
  out += kv("Balance Trend", balanceTrend);

  out += subsection("LLM Interpretation");
  out += d.interpretation + "\n";

  return out;
}

function buildRegimes(brief: {
  derivatives: { regime: string; previousRegime: string | null; stress: string | null } | null;
  etfs: { regime: string; previousRegime: string | null } | null;
  htf: { regime: string; previousRegime: string | null; lastStructure: string | null } | null;
  sentiment: { regime: string; previousRegime: string | null; compositeIndex: number | null } | null;
  exchangeFlows: { regime: string; previousRegime: string | null } | null;
}): string {
  let out = section("REGIME SUMMARY");

  const dims = [
    { label: "Derivatives Structure", regime: brief.derivatives?.regime, prev: brief.derivatives?.previousRegime, extra: brief.derivatives?.stress ? `stress=${brief.derivatives.stress}` : null },
    { label: "Institutional Flows (ETFs)", regime: brief.etfs?.regime, prev: brief.etfs?.previousRegime },
    { label: "HTF Technical", regime: brief.htf?.regime, prev: brief.htf?.previousRegime, extra: brief.htf?.lastStructure ? `struct=${brief.htf.lastStructure}` : null },
    { label: "Market Sentiment", regime: brief.sentiment?.regime, prev: brief.sentiment?.previousRegime, extra: brief.sentiment?.compositeIndex != null ? `F&G=${brief.sentiment.compositeIndex.toFixed(0)}` : null },
    { label: "Exchange Flows", regime: brief.exchangeFlows?.regime, prev: brief.exchangeFlows?.previousRegime },
  ];

  for (const d of dims) {
    const flipped = d.prev && d.prev !== d.regime;
    const regimeStr = flipped
      ? `${d.prev} → ${d.regime}  [FLIP]`
      : (d.regime ?? "—");
    const extra = d.extra ? `  (${d.extra})` : "";
    out += `${d.label.padEnd(32)} ${regimeStr}${extra}\n`;
  }

  return out;
}

function buildConfluence(storedOutputs: DimensionOutput[]): string {
  let out = section("CONFLUENCE SCORING (reconstructed from stored contexts)");

  if (storedOutputs.length === 0) {
    return out + "Cannot reconstruct — no dimension data in brief\n";
  }

  const directions: Direction[] = ["LONG", "SHORT", "FLAT"];
  const scored = directions.map((dir) => ({
    direction: dir,
    confluence: computeConfluence(storedOutputs, dir),
  }));

  out += `${"Direction".padEnd(8)} ${"derivatives".padEnd(14)} ${"etfs".padEnd(8)} ${"htf".padEnd(8)} ${"exchFlows".padEnd(12)} total\n`;
  out += sep("─", 58) + "\n";
  for (const s of scored) {
    const c = s.confluence;
    const pass = c.total >= CONVICTION_THRESHOLD ? "  [PASS]" : "";
    out += `${s.direction.padEnd(8)} ${String(c.derivatives).padEnd(14)} ${String(c.etfs).padEnd(8)} ${String(c.htf).padEnd(8)} ${String(c.exchangeFlows).padEnd(12)} ${c.total}${pass}\n`;
  }

  const longConf = scored.find((s) => s.direction === "LONG")!.confluence;
  const shortConf = scored.find((s) => s.direction === "SHORT")!.confluence;
  const bias = computeBias(longConf, shortConf);

  out += subsection("Directional Bias");
  out += kv("Lean", bias.lean);
  out += kv("Strength", `${bias.strength}/100`);
  out += kv("Conviction Gap", `${bias.convictionGap} pts ${bias.convictionGap >= 0 ? "(above threshold)" : "(below threshold)"}`);
  if (bias.topFactors.length > 0) {
    out += kv("Top Factors", bias.topFactors.map((f) => `${f.dimension}:+${f.score}`).join("  "));
  }

  return out;
}

function buildTradeIdea(tradeIdea: {
  id: string;
  direction: string;
  skipped: boolean;
  entryPrice: number;
  compositeTarget: number;
  confluence: unknown;
  createdAt: Date;
  levels: Array<{ type: string; label: string; price: number; outcome: string; qualityScore: number | null; resolvedAt: Date | null }>;
  returns: Array<{ hoursAfter: number; price: number; returnPct: number; qualityAtPoint: number }>;
}): string {
  let out = section("TRADE IDEA");

  out += kv("Trade ID", tradeIdea.id);
  out += kv("Direction", tradeIdea.direction);
  out += kv("Skipped", tradeIdea.skipped ? "YES (conviction below threshold)" : "NO (trade taken)");
  out += kv("Entry Price", price(tradeIdea.entryPrice));
  out += kv("Composite Target", price(tradeIdea.compositeTarget));
  const distPct = (tradeIdea.compositeTarget - tradeIdea.entryPrice) / tradeIdea.entryPrice * 100;
  out += kv("Target Distance", `${Math.abs(tradeIdea.compositeTarget - tradeIdea.entryPrice).toFixed(2)} (${pct(distPct)})`);
  out += kv("Created", `${tradeIdea.createdAt.toISOString()} (${ago(tradeIdea.createdAt)})`);

  const conf = tradeIdea.confluence as Confluence & { bias?: Record<string, unknown> } | null;
  if (conf) {
    out += subsection("Stored Confluence");
    const dimKeys = ["derivatives", "etfs", "htf", "exchangeFlows"] as const;
    for (const dk of dimKeys) {
      if (dk in conf) out += kv(dk, String(conf[dk]));
    }
    out += kv("Total", String(conf.total));

    if (conf.bias) {
      const b = conf.bias;
      out += "\n";
      out += kv("Bias Lean", String(b.lean));
      out += kv("Bias Strength", `${b.strength}/100`);
      out += kv("Conviction Gap", `${b.convictionGap} pts`);
      if (Array.isArray(b.topFactors) && b.topFactors.length > 0) {
        out += kv("Top Factors", b.topFactors.map((f: Record<string, unknown>) => `${f.dimension}:+${f.score}`).join("  "));
      }
    }
  }

  if (tradeIdea.levels.length > 0) {
    out += subsection("Levels");
    const invalidations = tradeIdea.levels.filter((l) => l.type === "INVALIDATION");
    const targets = tradeIdea.levels.filter((l) => l.type === "TARGET");

    if (invalidations.length > 0) {
      out += "Invalidation (Stop Loss):\n";
      for (const l of invalidations) {
        const d = (l.price - tradeIdea.entryPrice) / tradeIdea.entryPrice * 100;
        const quality = l.qualityScore != null ? `  quality=${num(l.qualityScore)}` : "";
        const resolved = l.resolvedAt ? `  resolved=${l.resolvedAt.toISOString()}` : "";
        out += `  ${l.label.padEnd(5)} ${price(l.price).padEnd(16)} (${pct(d)})  outcome=${l.outcome}${quality}${resolved}\n`;
      }
    }
    if (targets.length > 0) {
      out += "Targets (Take Profit):\n";
      for (const l of targets) {
        const d = (l.price - tradeIdea.entryPrice) / tradeIdea.entryPrice * 100;
        const quality = l.qualityScore != null ? `  quality=${num(l.qualityScore)}` : "";
        const resolved = l.resolvedAt ? `  resolved=${l.resolvedAt.toISOString()}` : "";
        out += `  ${l.label.padEnd(5)} ${price(l.price).padEnd(16)} (${pct(d)})  outcome=${l.outcome}${quality}${resolved}\n`;
      }
    }
  }

  if (tradeIdea.returns.length > 0) {
    out += subsection("Price Returns (post-trade tracking)");
    out += `${"Hours".padEnd(8)} ${"Price".padEnd(16)} ${"Return".padEnd(12)} Quality\n`;
    out += sep("─", 44) + "\n";
    for (const r of tradeIdea.returns) {
      const label = r.hoursAfter < 24 ? `${r.hoursAfter}h` : r.hoursAfter < 168 ? `${r.hoursAfter / 24}d` : `${(r.hoursAfter / 168).toFixed(0)}w`;
      out += `${label.padEnd(8)} ${price(r.price).padEnd(16)} ${pct(r.returnPct).padEnd(12)} ${num(r.qualityAtPoint)}\n`;
    }
  }

  return out;
}

function buildRichBrief(richBrief: { blocks: Array<Record<string, unknown>> }): string {
  let out = section("RICH BRIEF BLOCKS");

  for (const block of richBrief.blocks) {
    const tag = `[${String(block.type).toUpperCase()}]`;
    out += `${tag}\n`;

    if (block.type === "regime_banner") {
      out += `  Regime:   ${block.regime}\n`;
      out += `  Sentiment: ${block.sentiment}\n`;
      if (block.subtitle) out += `  Subtitle: ${block.subtitle}\n`;
    } else if (block.type === "tension") {
      const left = block.left as Record<string, unknown>;
      const right = block.right as Record<string, unknown>;
      out += `  Title: ${block.title}\n`;
      out += `  LEFT  (${left.label}): ${left.content}\n`;
      out += `  RIGHT (${right.label}): ${right.content}\n`;
    } else if (block.type === "callout") {
      out += `  Variant: ${block.variant}\n`;
      out += `  Title:   ${block.title}\n`;
      out += `  Content: ${block.content}\n`;
    } else if (block.type === "signal") {
      out += `  Direction: ${block.direction}  Strength: ${block.strength}/3\n`;
      out += `  Label: ${block.label}\n`;
      if (block.description) out += `  Description: ${block.description}\n`;
    } else if (block.type === "level_map") {
      const levels = block.levels as Array<Record<string, unknown>>;
      out += `  Current: ${price(block.current as number)}\n`;
      for (const l of levels) {
        out += `  ${String(l.label).padEnd(40)} ${price(l.price as number)}\n`;
      }
    } else if (block.type === "metric_row") {
      const items = block.items as Array<Record<string, unknown>>;
      for (const i of items) {
        out += `  ${String(i.label).padEnd(24)} ${i.value}${i.sentiment ? ` (${i.sentiment})` : ""}\n`;
      }
    } else if (block.type === "scorecard") {
      const items = block.items as Array<Record<string, unknown>>;
      if (block.title) out += `  Title: ${block.title}\n`;
      for (const i of items) {
        out += `  ${String(i.label).padEnd(32)} ${i.score}\n`;
      }
    } else if (block.type === "spectrum") {
      out += `  ${block.label}: ${block.value}  (${block.leftLabel} ↔ ${block.rightLabel})\n`;
    } else if (block.type === "heatmap") {
      const cells = block.cells as Array<Record<string, unknown>>;
      if (block.title) out += `  Title: ${block.title}\n`;
      for (const c of cells) {
        out += `  ${String(c.label).padEnd(24)} ${c.value}\n`;
      }
    } else if (block.type === "heading") {
      out += `  ${block.text}\n`;
    } else if (block.type === "text") {
      out += `  ${block.content}\n`;
    } else {
      out += `  ${JSON.stringify(block)}\n`;
    }
    out += "\n";
  }

  return out;
}

// ─── Reconstruct DimensionOutput[] from stored brief ─────────────────────────

function buildOutputsFromBrief(brief: {
  derivatives: { regime: string; previousRegime: string | null; stress: string | null; previousStress: string | null; oiSignal: string | null; since: Date; context: unknown; interpretation: string } | null;
  etfs: { regime: string; previousRegime: string | null; since: Date; context: unknown; interpretation: string } | null;
  htf: { regime: string; previousRegime: string | null; since: Date; lastStructure: string | null; snapshotPrice: number | null; context: unknown; interpretation: string } | null;
  sentiment: { regime: string; previousRegime: string | null; since: Date; compositeIndex: number | null; compositeLabel: string | null; positioning: number | null; trend: number | null; institutionalFlows: number | null; exchangeFlows: number | null; expertConsensus: number | null; context: unknown; interpretation: string } | null;
  exchangeFlows: { regime: string; previousRegime: string | null; since: Date; context: unknown; interpretation: string } | null;
}): DimensionOutput[] {
  const outputs: DimensionOutput[] = [];

  if (brief.derivatives) {
    outputs.push({
      dimension: "DERIVATIVES",
      regime: brief.derivatives.regime,
      stress: brief.derivatives.stress,
      previousRegime: brief.derivatives.previousRegime,
      previousStress: brief.derivatives.previousStress,
      oiSignal: brief.derivatives.oiSignal,
      since: brief.derivatives.since.toISOString(),
      context: brief.derivatives.context,
      interpretation: brief.derivatives.interpretation,
    } as DerivativesOutput);
  }
  if (brief.etfs) {
    outputs.push({
      dimension: "ETFS",
      regime: brief.etfs.regime,
      previousRegime: brief.etfs.previousRegime,
      since: brief.etfs.since.toISOString(),
      context: brief.etfs.context,
      interpretation: brief.etfs.interpretation,
    } as EtfsOutput);
  }
  if (brief.htf) {
    outputs.push({
      dimension: "HTF",
      regime: brief.htf.regime,
      previousRegime: brief.htf.previousRegime,
      since: brief.htf.since.toISOString(),
      lastStructure: brief.htf.lastStructure,
      snapshotPrice: brief.htf.snapshotPrice,
      context: brief.htf.context,
      interpretation: brief.htf.interpretation,
    } as HtfOutput);
  }
  if (brief.sentiment) {
    outputs.push({
      dimension: "SENTIMENT",
      regime: brief.sentiment.regime,
      previousRegime: brief.sentiment.previousRegime,
      since: brief.sentiment.since.toISOString(),
      compositeIndex: brief.sentiment.compositeIndex,
      compositeLabel: brief.sentiment.compositeLabel,
      positioning: brief.sentiment.positioning,
      trend: brief.sentiment.trend,
      institutionalFlows: brief.sentiment.institutionalFlows,
      exchangeFlows: brief.sentiment.exchangeFlows,
      expertConsensus: brief.sentiment.expertConsensus,
      context: brief.sentiment.context,
      interpretation: brief.sentiment.interpretation,
    } as SentimentOutput);
  }
  if (brief.exchangeFlows) {
    outputs.push({
      dimension: "EXCHANGE_FLOWS",
      regime: brief.exchangeFlows.regime,
      previousRegime: brief.exchangeFlows.previousRegime,
      since: brief.exchangeFlows.since.toISOString(),
      context: brief.exchangeFlows.context,
      interpretation: brief.exchangeFlows.interpretation,
    } as ExchangeFlowsOutput);
  }

  return outputs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { runId, briefId, asset } = await resolveTarget();

  const [run, brief, tradeIdea, prevBrief] = await Promise.all([
    runId ? prisma.notifyRun.findUnique({ where: { id: runId } }) : null,
    prisma.brief.findUniqueOrThrow({
      where: { id: briefId },
      include: { derivatives: true, etfs: true, htf: true, sentiment: true, exchangeFlows: true },
    }),
    prisma.tradeIdea.findUnique({
      where: { briefId },
      include: { levels: { orderBy: { label: "asc" } }, returns: { orderBy: { hoursAfter: "asc" } } },
    }),
    prisma.brief.findFirst({
      where: { asset: asset as "BTC" | "ETH", id: { not: briefId } },
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        timestamp: true,
        derivatives: { select: { regime: true } },
        etfs: { select: { regime: true } },
        htf: { select: { regime: true, snapshotPrice: true } },
        sentiment: { select: { regime: true, compositeIndex: true } },
        exchangeFlows: { select: { regime: true } },
      },
    }),
  ]);

  const artifacts = run ? ((run.artifacts as RunArtifacts) ?? {}) : {} as RunArtifacts;
  const storedOutputs = buildOutputsFromBrief(brief);

  // Reconstruct trade decision for LLM prompt rebuilding
  let promptDecision: TradeDecision | null = null;
  if (tradeIdea) {
    const storedConf = tradeIdea.confluence as unknown as Confluence & { bias?: DirectionalBias };
    promptDecision = {
      direction: tradeIdea.direction as Direction,
      confluence: storedConf,
      entryPrice: tradeIdea.entryPrice,
      compositeTarget: tradeIdea.compositeTarget,
      skipped: tradeIdea.skipped,
      threshold: 200, // not persisted; use default (compression-aware threshold only applies at run time)
      alternatives: [], // not persisted
      bias: (storedConf?.bias ?? { lean: "NEUTRAL", strength: 0, convictionGap: 0, topFactors: [] }) as DirectionalBias,
    };
  }

  const storedDelta: DeltaSummary | null = artifacts.deltaSummary ?? null;
  const isDeltaBrief = storedDelta?.tier === "medium";

  // Create output directory
  const outDir = nodePath.join(DEBUG_BASE, briefId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n${chalk.bold("BRIEF DEBUG")} — ${chalk.cyan(asset)}`);
  console.log(chalk.dim(`Writing to ${nodePath.relative(process.cwd(), outDir)}/\n`));

  if (run) write(outDir, "00-run.txt", buildRun(run, artifacts));
  write(outDir, "01-overview.txt", buildOverview(brief, prevBrief));
  if (brief.derivatives) write(outDir, "02-dim-derivatives.txt", buildDimDerivatives(brief.derivatives));
  if (brief.etfs) write(outDir, "03-dim-etfs.txt", buildDimEtfs(brief.etfs));
  if (brief.htf) write(outDir, "04-dim-htf.txt", buildDimHtf(brief.htf));
  if (brief.sentiment) write(outDir, "05-dim-sentiment.txt", buildDimSentiment(brief.sentiment));
  if (brief.exchangeFlows) write(outDir, "06-dim-exchange-flows.txt", buildDimExchangeFlows(brief.exchangeFlows));
  write(outDir, "07-regimes.txt", buildRegimes(brief));
  write(outDir, "08-confluence.txt", buildConfluence(storedOutputs));
  if (tradeIdea) write(outDir, "09-trade-idea.txt", buildTradeIdea(tradeIdea));
  if (brief.richBrief) write(outDir, "10-rich-brief.txt", buildRichBrief(brief.richBrief as { blocks: Array<Record<string, unknown>> }));
  write(outDir, "11-brief-text.txt", brief.brief);
  write(outDir, "12-llm-system-prompt.txt", buildSystemPrompt(promptDecision, isDeltaBrief));
  write(outDir, "13-llm-user-prompt.txt", buildPrompt(asset as "BTC" | "ETH", storedOutputs, promptDecision, storedDelta));

  const contexts: Record<string, unknown> = {};
  if (brief.derivatives) contexts.derivatives = brief.derivatives.context;
  if (brief.etfs) contexts.etfs = brief.etfs.context;
  if (brief.htf) contexts.htf = brief.htf.context;
  if (brief.sentiment) contexts.sentiment = brief.sentiment.context;
  if (brief.exchangeFlows) contexts.exchangeFlows = brief.exchangeFlows.context;
  write(outDir, "raw-context.json", JSON.stringify(contexts, null, 2));

  console.log(`\n${chalk.dim(`→ ${outDir}`)}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
