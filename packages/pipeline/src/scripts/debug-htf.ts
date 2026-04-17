/**
 * Debug script — full HTF Technical Structure analysis inspection.
 *
 * Runs the complete collect → analyze pipeline and prints every computed
 * indicator, the regime decision trace, and an ASCII volume profile.
 *
 * Usage:
 *   tsx src/scripts/debug-htf.ts --asset [BTC|ETH]
 */

import "../env.js";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { collect } from "../htf/collector.js";
import { analyze } from "../htf/analyzer.js";
import type { HtfContext, HtfState, VolumeProfileResult } from "../htf/types.js";
import { parseAsset } from "./utils.js";

// ─── State loader ─────────────────────────────────────────────────────────────

function loadState(asset: string): HtfState | null {
  const file = path.resolve("data", "htf_state.json");
  if (!fs.existsSync(file)) return null;
  const all = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, HtfState>;
  return all[asset] ?? null;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt$(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  const color = v >= 0 ? chalk.green : chalk.red;
  return color(`${sign}${v.toFixed(2)}%`);
}

function fmtRsi(v: number): string {
  const s = v.toFixed(1);
  if (v > 70) return chalk.yellow.bold(s);
  if (v < 30) return chalk.cyan.bold(s);
  return chalk.white(s);
}

function bool(v: boolean): string {
  return v ? chalk.green("YES") : chalk.dim("no");
}

function hdr(title: string): void {
  console.log(`\n${chalk.dim("─── " + title + " " + "─".repeat(Math.max(0, 48 - title.length)))}`);
}

function row(label: string, value: string): void {
  console.log(`  ${chalk.dim(label.padEnd(28))}${value}`);
}

// ─── Regime decision trace ────────────────────────────────────────────────────

function printRegimeTrace(ctx: HtfContext): void {
  hdr("Regime decision trace");

  const { ma, rsi, cvd, structure } = ctx;
  const aboveSma200 = ma.priceVsSma200Pct > 0;
  const aboveSma50 = ma.priceVsSma50Pct > 0;

  const check = (cond: boolean, label: string) => `${cond ? chalk.green("✓") : chalk.dim("✗")}  ${label}`;

  console.log(`  ${check(aboveSma200, `price > 200 DMA  (${fmtPct(ma.priceVsSma200Pct)})`)} `);
  console.log(`  ${check(aboveSma50, `price > 50 DMA   (${fmtPct(ma.priceVsSma50Pct)})`)} `);
  console.log(`  ${check(rsi.daily > 70, `daily RSI > 70   (${rsi.daily.toFixed(1)})`)} `);
  console.log(`  ${check(rsi.daily < 30, `daily RSI < 30   (${rsi.daily.toFixed(1)})`)} `);
  console.log(`  ${check(structure === "LH_LL", `structure = LH_LL  (${structure})`)} `);
  console.log(
    `  ${check(cvd.futures.long.regime === "RISING", `futures CVD long = RISING  (${cvd.futures.long.regime})`)} `,
  );
  console.log(`  ${check(cvd.futures.long.regime === "DECLINING", `futures CVD long = DECLINING`)} `);

  console.log();

  if (aboveSma200) {
    if (rsi.daily > 70) {
      console.log(`  → ${chalk.yellow.bold("BULL_EXTENDED")}  (above 200 DMA + RSI overbought)`);
    } else {
      console.log(`  → ${chalk.green.bold("MACRO_BULLISH")}  (above 200 DMA, RSI normal)`);
    }
  } else if (aboveSma50 && !aboveSma200) {
    console.log(`  → ${chalk.cyan("RECLAIMING")}  (between 50 and 200 DMA)`);
  } else {
    // below both MAs
    if (rsi.daily < 30) {
      console.log(`  → ${chalk.red("BEAR_EXTENDED")}  (below both MAs + RSI oversold)`);
    } else if (structure === "LH_LL") {
      console.log(`  → ${chalk.red.bold("MACRO_BEARISH")}  (below both MAs + LH_LL structure)`);
    } else if (cvd.futures.long.regime === "RISING") {
      console.log(`  → ${chalk.blue("ACCUMULATION")}  (below both MAs + futures CVD rising)`);
    } else if (cvd.futures.long.regime === "DECLINING") {
      console.log(`  → ${chalk.magenta("DISTRIBUTION")}  (below both MAs + futures CVD declining)`);
    } else {
      console.log(`  → ${chalk.white("RANGING")}  (below both MAs, CVD flat)`);
    }
  }

  console.log(`\n  Computed regime: ${chalk.bold(ctx.regime)}`);
}

// ─── ASCII volume profile ─────────────────────────────────────────────────────

function printAsciiProfile(vp: VolumeProfileResult, currentPrice: number): void {
  const allPrices = [vp.poc, vp.vaHigh, vp.vaLow, currentPrice, ...vp.hvns, ...vp.lvns]
    .filter((p) => p > 0)
    .sort((a, b) => b - a);

  if (allPrices.length < 2) return;

  const maxPrice = Math.max(...allPrices) * 1.005;
  const minPrice = Math.min(...allPrices) * 0.995;
  const rows = 25;
  const step = (maxPrice - minPrice) / rows;
  const BAR_WIDTH = 40;

  hdr("Visual volume profile");
  console.log(`  Price range: ${fmt$(minPrice)} – ${fmt$(maxPrice)}\n`);

  for (let i = 0; i < rows; i++) {
    const rowHigh = maxPrice - i * step;
    const rowLow = rowHigh - step;
    const rowMid = (rowHigh + rowLow) / 2;

    const inVA = rowMid >= vp.vaLow && rowMid <= vp.vaHigh;
    const distFromPoc = Math.abs(rowMid - vp.poc) / step;

    let barLen: number;
    if (distFromPoc < 1) {
      barLen = BAR_WIDTH;
    } else if (inVA) {
      barLen = Math.max(6, Math.round(BAR_WIDTH * 0.7 * (1 - distFromPoc / (rows / 2))));
    } else {
      barLen = Math.max(2, Math.round(BAR_WIDTH * 0.2 * (1 - distFromPoc / rows)));
    }

    const isHvn = vp.hvns.some((h) => Math.abs(h - rowMid) < step);
    const isLvn = vp.lvns.some((l) => Math.abs(l - rowMid) < step);
    const barChar = isLvn ? "·" : inVA ? "█" : "░";
    const bar = barChar.repeat(barLen);

    const markers: string[] = [];
    if (Math.abs(rowMid - vp.poc) < step) markers.push(chalk.yellow("◄ POC"));
    if (Math.abs(rowMid - currentPrice) < step) markers.push(chalk.white.bold("◄ PRICE"));
    if (Math.abs(rowMid - vp.vaHigh) < step) markers.push(chalk.dim("◄ VA High"));
    if (Math.abs(rowMid - vp.vaLow) < step) markers.push(chalk.dim("◄ VA Low"));
    if (isHvn) markers.push(chalk.green("◄ HVN"));
    if (isLvn) markers.push(chalk.cyan("◄ LVN"));

    const priceLabel = `$${rowMid.toFixed(0).padStart(7)}`;
    console.log(`  ${priceLabel} │${bar.padEnd(BAR_WIDTH)}│ ${markers.join(" ")}`);
  }

  console.log("");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();

  console.log(`\n${chalk.bold("HTF STRUCTURE DEBUG")}  ${chalk.dim(asset)}  ${chalk.dim(new Date().toUTCString())}`);
  console.log(chalk.dim("─".repeat(62)));

  // ── Collect ──────────────────────────────────────────────────────────────────
  console.log("\nFetching HTF data...");
  const snapshot = await collect(asset);

  hdr("Snapshot");
  row("Timestamp", chalk.dim(snapshot.timestamp));
  row("4h spot candles", chalk.white(String(snapshot.h4Candles.length)));
  row("Daily spot candles", chalk.white(String(snapshot.dailyCandles.length)));
  row("4h futures candles", chalk.white(String(snapshot.futuresH4Candles.length)));
  row("Current price", chalk.white.bold(fmt$(snapshot.h4Candles.at(-1)?.close ?? 0)));

  // ── Analyze ──────────────────────────────────────────────────────────────────
  const prevState = loadState(asset);
  const { context: ctx } = analyze(snapshot, prevState);

  // ── Regime ───────────────────────────────────────────────────────────────────
  hdr("Regime");
  row("Current", chalk.bold(ctx.regime));
  row("Previous", ctx.previousRegime ? chalk.dim(ctx.previousRegime) : chalk.dim("(none)"));
  row("Since", chalk.dim(ctx.since));
  row("Duration", chalk.white(`${ctx.durationDays}d`));

  // ── Bias scores ─────────────────────────────────────────────────────────────
  hdr("Bias scores (continuous)");
  const b = ctx.bias;
  const fmtBias = (v: number) => {
    const s = (v >= 0 ? "+" : "") + v.toFixed(3);
    return v > 0.1 ? chalk.green(s) : v < -0.1 ? chalk.red(s) : chalk.dim(s);
  };
  const bar = (v: number, width = 20) => {
    const mid = Math.floor(width / 2);
    const filled = Math.round(Math.abs(v) * mid);
    const chars = Array(width).fill("·");
    if (v > 0) for (let i = mid; i < mid + filled && i < width; i++) chars[i] = "█";
    else for (let i = mid - filled; i < mid; i++) chars[i] = "█";
    chars[mid] = "│";
    const s = chars.join("");
    return v > 0.1 ? chalk.green(s) : v < -0.1 ? chalk.red(s) : chalk.dim(s);
  };
  row("Trend (MA pull)", `${fmtBias(b.trend)}  ${bar(b.trend)}`);
  row("Momentum (RSI)", `${fmtBias(b.momentum)}  ${bar(b.momentum)}`);
  row("Flow (CVD)", `${fmtBias(b.flow)}  ${bar(b.flow)}`);
  row(
    "Compression",
    `${chalk.white(b.compression.toFixed(3))}  ${chalk.yellow("█".repeat(Math.round(b.compression * 20)).padEnd(20, "·"))}`,
  );
  row("VP gravity", `${fmtBias(b.vpGravity)}  ${bar(b.vpGravity)}`);
  row("STH gravity", `${fmtBias(b.sthGravity)}  ${bar(b.sthGravity)}`);
  console.log();
  const compColor = b.composite > 0.1 ? chalk.green.bold : b.composite < -0.1 ? chalk.red.bold : chalk.yellow.bold;
  row("COMPOSITE", `${compColor((b.composite >= 0 ? "+" : "") + b.composite.toFixed(3))}  ${bar(b.composite, 30)}`);

  // ── Price & MAs ───────────────────────────────────────────────────────────────
  hdr("Price & Moving Averages");
  row("Price", chalk.white.bold(fmt$(ctx.price)));
  row("SMA 50 (4h)", `${chalk.white(fmt$(ctx.ma.sma50))}  ${fmtPct(ctx.ma.priceVsSma50Pct)}`);
  row("SMA 200 (4h)", `${chalk.white(fmt$(ctx.ma.sma200))}  ${fmtPct(ctx.ma.priceVsSma200Pct)}`);
  row(
    "MA cross (current)",
    ctx.ma.crossType === "GOLDEN"
      ? chalk.green.bold(ctx.ma.crossType)
      : ctx.ma.crossType === "DEATH"
        ? chalk.red.bold(ctx.ma.crossType)
        : chalk.dim(ctx.ma.crossType),
  );
  row(
    "MA cross (recent)",
    ctx.ma.recentCross !== "NONE" ? chalk.yellow.bold(`${ctx.ma.recentCross} (last 10 candles)`) : chalk.dim("none"),
  );

  // ── RSI ───────────────────────────────────────────────────────────────────────
  hdr("RSI");
  row("Daily RSI-14", fmtRsi(ctx.rsi.daily));
  row("4h RSI-14", fmtRsi(ctx.rsi.h4));

  // ── Market Structure ──────────────────────────────────────────────────────────
  hdr("Market Structure (daily pivots)");
  const structColor =
    ctx.structure === "HH_HL" ? chalk.green.bold : ctx.structure === "LH_LL" ? chalk.red.bold : chalk.yellow;
  row("Structure", structColor(ctx.structure.replace("_", "/")));

  // ── CVD ───────────────────────────────────────────────────────────────────────
  hdr("CVD — Futures (4h)");
  const fc = ctx.cvd.futures;
  row("Cumulative delta (long)", chalk.white(fc.value.toFixed(2)));
  row(
    "Short window (20c)",
    `regime=${chalk.bold(fc.short.regime)}  slope=${fc.short.slope.toFixed(4)}  R²=${fc.short.r2.toFixed(3)}`,
  );
  row(
    "Long window (75c)",
    `regime=${chalk.bold(fc.long.regime)}  slope=${fc.long.slope.toFixed(4)}  R²=${fc.long.r2.toFixed(3)}`,
  );
  row(
    "Divergence",
    fc.divergence !== "NONE" ? chalk.yellow.bold(`${fc.divergence} (${fc.divergenceMechanism})`) : chalk.dim("none"),
  );
  row(
    "Extreme",
    fc.extreme.state !== "NONE"
      ? chalk.yellow.bold(
          `${fc.extreme.state}  pctile=${fc.extreme.changePctile}  ext=${fc.extreme.extensionPct.toFixed(1)}%`,
        )
      : chalk.dim(`none  (pctile=${fc.extreme.changePctile}  ext=${fc.extreme.extensionPct.toFixed(1)}%)`),
  );

  // ── Divergence debug: dump pivots on futures long window ───────────────────
  {
    const LOOKBACK = 14;
    const MIN_PIVOT_DISTANCE = 5;
    const MIN_PRICE_SWING_PCT = 0.5;
    const CVD_LONG_LOOKBACK = 75;
    const futuresLong = snapshot.futuresH4Candles.slice(-CVD_LONG_LOOKBACK);
    // rebuild CVD curve
    const cvdCurve: number[] = [];
    let running = 0;
    for (const c of futuresLong) {
      running += 2 * c.takerBuyVolume - c.volume;
      cvdCurve.push(running);
    }
    // swing highs/lows
    const swH = (vals: number[], lb: number) => {
      const r: { index: number; value: number }[] = [];
      for (let i = lb; i < vals.length - lb; i++) {
        const v = vals[i]!;
        let ok = true;
        for (let j = 1; j <= lb; j++) {
          if (vals[i - j]! >= v || vals[i + j]! >= v) {
            ok = false;
            break;
          }
        }
        if (ok) r.push({ index: i, value: v });
      }
      return r;
    };
    const swL = (vals: number[], lb: number) => {
      const r: { index: number; value: number }[] = [];
      for (let i = lb; i < vals.length - lb; i++) {
        const v = vals[i]!;
        let ok = true;
        for (let j = 1; j <= lb; j++) {
          if (vals[i - j]! <= v || vals[i + j]! <= v) {
            ok = false;
            break;
          }
        }
        if (ok) r.push({ index: i, value: v });
      }
      return r;
    };
    const lastTwo = <T extends { index: number; value: number }>(arr: T[]): [T, T] | null => {
      for (let i = arr.length - 1; i >= 1; i--) {
        if (arr[i]!.index - arr[i - 1]!.index >= MIN_PIVOT_DISTANCE) {
          return [arr[i - 1]!, arr[i]!];
        }
      }
      return null;
    };
    const priceHighs = futuresLong.map((c) => c.high);
    const priceLows = futuresLong.map((c) => c.low);
    const pH = swH(priceHighs, LOOKBACK);
    const pL = swL(priceLows, LOOKBACK);
    const cH = swH(cvdCurve, LOOKBACK);
    const cL = swL(cvdCurve, LOOKBACK);

    hdr("Divergence Debug — Futures pivots (long window)");
    console.log(
      `  ${chalk.dim(`LOOKBACK=${LOOKBACK}  MIN_DIST=${MIN_PIVOT_DISTANCE}  MIN_SWING=${MIN_PRICE_SWING_PCT}%`)}`,
    );
    console.log(`  Price swing highs (${pH.length} total, last 5):`);
    for (const p of pH.slice(-5)) {
      const candle = futuresLong[p.index]!;
      console.log(`    idx=${p.index}  high=${fmt$(p.value)}  time=${new Date(candle.time).toISOString()}`);
    }
    console.log(`  Price swing lows (${pL.length} total, last 5):`);
    for (const p of pL.slice(-5)) {
      const candle = futuresLong[p.index]!;
      console.log(`    idx=${p.index}  low=${fmt$(p.value)}  time=${new Date(candle.time).toISOString()}`);
    }
    console.log(`  CVD swing highs (${cH.length} total, last 5):`);
    for (const p of cH.slice(-5)) {
      const candle = futuresLong[p.index]!;
      console.log(`    idx=${p.index}  cvd=${p.value.toFixed(2)}  time=${new Date(candle.time).toISOString()}`);
    }
    console.log(`  CVD swing lows (${cL.length} total, last 5):`);
    for (const p of cL.slice(-5)) {
      const candle = futuresLong[p.index]!;
      console.log(`    idx=${p.index}  cvd=${p.value.toFixed(2)}  time=${new Date(candle.time).toISOString()}`);
    }

    const pHPair = lastTwo(pH);
    const pLPair = lastTwo(pL);
    const cHPair = lastTwo(cH);
    const cLPair = lastTwo(cL);

    if (pHPair && pLPair && cHPair && cLPair) {
      const priceMid = (pHPair[1].value + pLPair[1].value) / 2;
      const minSwing = priceMid * (MIN_PRICE_SWING_PCT / 100);
      const priceHH = pHPair[1].value > pHPair[0].value && Math.abs(pHPair[1].value - pHPair[0].value) >= minSwing;
      const cvdHH = cHPair[1].value > cHPair[0].value;
      const priceLL = pLPair[1].value < pLPair[0].value && Math.abs(pLPair[1].value - pLPair[0].value) >= minSwing;
      const cvdLL = cLPair[1].value < cLPair[0].value;
      const priceDiffH = Math.abs(pHPair[1].value - pHPair[0].value);
      const priceDiffL = Math.abs(pLPair[1].value - pLPair[0].value);
      console.log(`\n  Decision (minSwing=${fmt$(minSwing)}):`);
      console.log(
        `    priceHH=${priceHH} (${fmt$(pHPair[0].value)} → ${fmt$(pHPair[1].value)}, diff=${fmt$(priceDiffH)}, dist=${pHPair[1].index - pHPair[0].index}c)`,
      );
      console.log(
        `    cvdHH  =${cvdHH}   (${cHPair[0].value.toFixed(2)} → ${cHPair[1].value.toFixed(2)}, dist=${cHPair[1].index - cHPair[0].index}c)`,
      );
      console.log(
        `    priceLL=${priceLL} (${fmt$(pLPair[0].value)} → ${fmt$(pLPair[1].value)}, diff=${fmt$(priceDiffL)}, dist=${pLPair[1].index - pLPair[0].index}c)`,
      );
      console.log(
        `    cvdLL  =${cvdLL}   (${cLPair[0].value.toFixed(2)} → ${cLPair[1].value.toFixed(2)}, dist=${cLPair[1].index - cLPair[0].index}c)`,
      );

      if (cvdHH && !priceHH) console.log(`    → BEARISH ABSORPTION`);
      else if (cvdLL && !priceLL) console.log(`    → BULLISH ABSORPTION`);
      else if (priceHH && !cvdHH) console.log(`    → BEARISH EXHAUSTION`);
      else if (priceLL && !cvdLL) console.log(`    → BULLISH EXHAUSTION`);
      else console.log(`    → NONE`);
    } else {
      console.log(
        `\n  Not enough spaced pivots for divergence (pH=${!!pHPair} pL=${!!pLPair} cH=${!!cHPair} cL=${!!cLPair})`,
      );
    }
  }

  hdr("CVD — Spot (4h)");
  const sc = ctx.cvd.spot;
  row("Cumulative delta (long)", chalk.white(sc.value.toFixed(2)));
  row(
    "Short window (20c)",
    `regime=${chalk.bold(sc.short.regime)}  slope=${sc.short.slope.toFixed(4)}  R²=${sc.short.r2.toFixed(3)}`,
  );
  row(
    "Long window (75c)",
    `regime=${chalk.bold(sc.long.regime)}  slope=${sc.long.slope.toFixed(4)}  R²=${sc.long.r2.toFixed(3)}`,
  );
  row(
    "Divergence",
    sc.divergence !== "NONE" ? chalk.yellow.bold(`${sc.divergence} (${sc.divergenceMechanism})`) : chalk.dim("none"),
  );

  hdr("CVD — Spot vs Futures");
  const sfDiv = ctx.cvd.spotFuturesDivergence;
  const sfColor =
    sfDiv === "CONFIRMED_BUYING"
      ? chalk.green.bold
      : sfDiv === "CONFIRMED_SELLING"
        ? chalk.red.bold
        : sfDiv === "SUSPECT_BOUNCE"
          ? chalk.yellow.bold
          : sfDiv === "SPOT_LEADS"
            ? chalk.cyan
            : chalk.dim;
  row("Signal", sfColor(sfDiv));

  // ── VWAP ──────────────────────────────────────────────────────────────────────
  hdr("VWAP (anchored)");
  const vwapWeeklyPct = ((ctx.price - ctx.vwap.weekly) / ctx.vwap.weekly) * 100;
  const vwapMonthlyPct = ((ctx.price - ctx.vwap.monthly) / ctx.vwap.monthly) * 100;
  row("Weekly VWAP", `${chalk.white(fmt$(ctx.vwap.weekly))}  price ${fmtPct(vwapWeeklyPct)}`);
  row("Monthly VWAP", `${chalk.white(fmt$(ctx.vwap.monthly))}  price ${fmtPct(vwapMonthlyPct)}`);

  // ── STH Realized Price proxy ──────────────────────────────────────────────────
  hdr("STH Realized Price (155d VWAP proxy)");
  const sthAbove = ctx.price > ctx.sth.price;
  row("STH cost basis", `${chalk.white(fmt$(ctx.sth.price))}  price ${fmtPct(ctx.sth.priceVsSthPct)}`);
  row(
    "Position",
    sthAbove
      ? chalk.green("ABOVE  (STH holders in profit — latent sell pressure fades as support)")
      : chalk.red("BELOW  (STH holders underwater — strong mean-reversion target overhead)"),
  );
  row(
    "Gravity bias",
    `${(b.sthGravity >= 0 ? chalk.green : chalk.red)((b.sthGravity >= 0 ? "+" : "") + b.sthGravity.toFixed(3))}`,
  );

  // ── Volatility / ATR ──────────────────────────────────────────────────────────
  hdr("Volatility / ATR");
  const vol = ctx.volatility;
  row("ATR-14 (4h)", chalk.white(fmt$(vol.atr)));
  row(
    "ATR percentile (50c)",
    `${chalk.white(vol.atrPercentile.toFixed(0))}th  ${vol.atrPercentile <= 30 ? chalk.yellow("(compressed)") : chalk.dim("(normal)")}`,
  );
  row(
    "ATR ratio (cur/mean)",
    `${chalk.white(vol.atrRatio.toFixed(3))}  ${vol.atrRatio < 0.7 ? chalk.yellow("< 0.7 → compressed") : chalk.dim("")}`,
  );
  row("Recent displacement", `${chalk.white(vol.recentDisplacement.toFixed(2))}× ATR`);
  row("Coiled spring", bool(vol.compressionAfterMove));

  // ── Volume Profile ─────────────────────────────────────────────────────────────
  hdr("Volume Profile (displacement-anchored)");
  const vp = ctx.volumeProfile;
  row("Range start (candles back)", chalk.white(String(vp.rangeStartCandles)));
  row("Range (~days)", chalk.dim(`~${((vp.rangeStartCandles * 4) / 24).toFixed(1)}d`));
  row("POC", `${chalk.yellow.bold(fmt$(vp.profile.poc))}  (${vp.profile.pocVolumePct.toFixed(1)}% of volume)`);
  row("VA High", chalk.white(fmt$(vp.profile.vaHigh)));
  row("VA Low", chalk.white(fmt$(vp.profile.vaLow)));
  row(
    "VA width",
    `${chalk.white(fmt$(vp.profile.vaHigh - vp.profile.vaLow))}  (${(((vp.profile.vaHigh - vp.profile.vaLow) / vp.profile.poc) * 100).toFixed(2)}%)`,
  );
  row("Price vs POC", fmtPct(vp.profile.priceVsPocPct));
  row(
    "Price position",
    vp.profile.pricePosition === "ABOVE_VA"
      ? chalk.green(vp.profile.pricePosition)
      : vp.profile.pricePosition === "BELOW_VA"
        ? chalk.red(vp.profile.pricePosition)
        : chalk.white(vp.profile.pricePosition),
  );
  row(
    "HVNs (magnets)",
    vp.profile.hvns.length > 0 ? vp.profile.hvns.map((h) => chalk.green(fmt$(h))).join("  ") : chalk.dim("(none)"),
  );
  row(
    "LVNs (accel zones)",
    vp.profile.lvns.length > 0 ? vp.profile.lvns.map((l) => chalk.cyan(fmt$(l))).join("  ") : chalk.dim("(none)"),
  );

  // ── Sweep Levels ──────────────────────────────────────────────────────────────
  hdr("Liquidity Sweep Levels");
  if (ctx.sweep.nearestHigh) {
    const h = ctx.sweep.nearestHigh;
    row(
      "Nearest high target",
      `${chalk.red.bold(fmt$(h.price))}  ${chalk.dim(`${h.period.toLowerCase()}  ${h.ageDays.toFixed(0)}d old  dist: ${h.distancePct.toFixed(1)}%  attr: ${h.attraction.toFixed(1)}`)}`,
    );
  } else {
    row("Nearest high target", chalk.dim("(none)"));
  }
  if (ctx.sweep.nearestLow) {
    const l = ctx.sweep.nearestLow;
    row(
      "Nearest low target",
      `${chalk.green.bold(fmt$(l.price))}  ${chalk.dim(`${l.period.toLowerCase()}  ${l.ageDays.toFixed(0)}d old  dist: ${l.distancePct.toFixed(1)}%  attr: ${l.attraction.toFixed(1)}`)}`,
    );
  } else {
    row("Nearest low target", chalk.dim("(none)"));
  }
  row("Total levels", chalk.white(String(ctx.sweep.levels.length)));
  if (ctx.sweep.levels.length > 0) {
    console.log(
      `\n  ${"Dir".padEnd(4)}${"Price".padEnd(12)}${"Period".padEnd(10)}${"Age".padEnd(8)}${"Dist".padEnd(8)}Attr`,
    );
    console.log(`  ${"─".repeat(50)}`);
    for (const lvl of ctx.sweep.levels.slice(0, 8)) {
      const dir = lvl.type === "HIGH" ? chalk.red("▲") : chalk.green("▼");
      console.log(
        `  ${dir} ${fmt$(lvl.price).padEnd(11)}${lvl.period.padEnd(10)}${lvl.ageDays.toFixed(0).padStart(3)}d     ${lvl.distancePct.toFixed(1).padStart(4)}%   ${lvl.attraction.toFixed(1)}`,
      );
    }
  }

  // ── Signal Staleness ─────────────────────────────────────────────────────────
  hdr("Signal Staleness (candles since peak)");
  const st = ctx.staleness;
  row(
    "RSI extreme",
    st.rsiExtreme !== null ? `${chalk.white(String(st.rsiExtreme))} candles ago` : chalk.dim("(not present)"),
  );
  row(
    "CVD divergence peak",
    st.cvdDivergencePeak !== null
      ? `${chalk.white(String(st.cvdDivergencePeak))} candles ago`
      : chalk.dim("(not present)"),
  );
  row(
    "Last pivot",
    st.lastPivot !== null ? `${chalk.white(String(st.lastPivot))} candles ago` : chalk.dim("(not present)"),
  );

  // ── Events ───────────────────────────────────────────────────────────────────
  hdr("Events");
  if (ctx.events.length > 0) {
    for (const e of ctx.events) {
      console.log(`  ${chalk.yellow.bold(`[${e.type}]`)} ${chalk.yellow(e.detail)}`);
      console.log(`  ${chalk.dim("  at " + e.at)}`);
    }
  } else {
    console.log(`  ${chalk.dim("(none)")}`);
  }

  // ── Regime decision trace ─────────────────────────────────────────────────────
  printRegimeTrace(ctx);

  // ── Composite key levels ──────────────────────────────────────────────────────
  hdr("All key levels (sorted)");
  const levels = [
    { label: "SMA 200", price: ctx.ma.sma200 },
    { label: "SMA 50", price: ctx.ma.sma50 },
    { label: "STH cost basis (155d)", price: ctx.sth.price },
    { label: "VWAP weekly", price: ctx.vwap.weekly },
    { label: "VWAP monthly", price: ctx.vwap.monthly },
    { label: "VP POC", price: ctx.volumeProfile.profile.poc },
    { label: "VP VA High", price: ctx.volumeProfile.profile.vaHigh },
    { label: "VP VA Low", price: ctx.volumeProfile.profile.vaLow },
    ...ctx.volumeProfile.profile.hvns.map((p, i) => ({ label: `HVN ${i + 1}`, price: p })),
    ...ctx.volumeProfile.profile.lvns.map((p, i) => ({ label: `LVN ${i + 1}`, price: p })),
    ...(ctx.sweep.nearestHigh
      ? [{ label: `Sweep ▲ ${ctx.sweep.nearestHigh.period.toLowerCase()}`, price: ctx.sweep.nearestHigh.price }]
      : []),
    ...(ctx.sweep.nearestLow
      ? [{ label: `Sweep ▼ ${ctx.sweep.nearestLow.period.toLowerCase()}`, price: ctx.sweep.nearestLow.price }]
      : []),
  ].sort((a, b) => b.price - a.price);

  for (const lvl of levels) {
    const priceFmt = lvl.price === ctx.price ? chalk.white.bold(fmt$(lvl.price)) : chalk.white(fmt$(lvl.price));
    const distPct = ((ctx.price - lvl.price) / lvl.price) * 100;
    const distFmt = Math.abs(distPct) < 0.1 ? chalk.yellow.bold("← PRICE") : fmtPct(distPct);
    console.log(`  ${lvl.label.padEnd(22)}${priceFmt.padEnd(14)}${distFmt}`);
  }

  // ── ASCII profile ─────────────────────────────────────────────────────────────
  printAsciiProfile(ctx.volumeProfile.profile, ctx.price);
}

main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
