/**
 * Backfill per-dimension snapshot tables from existing `brief_<dim>` rows.
 *
 * For each `brief_<dim>` record we create a matching snapshot row keyed on
 * (asset, brief.timestamp), copying the analyzer context JSON and flattening
 * the scalar feature columns from the same dot-paths that orchestrator/delta.ts
 * uses for its METRIC_REGISTRY. We then point `brief_<dim>.snapshotId` at the
 * new snapshot.
 *
 * Idempotent: rows already linked to a snapshot are skipped, and the snapshot
 * insert is an upsert keyed on (asset, timestamp).
 *
 * Usage:
 *   pnpm --filter @market-intel/pipeline backfill:snapshots
 *   pnpm --filter @market-intel/pipeline backfill:snapshots --dry-run
 */

import chalk from "chalk";
import "../env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../storage/db.js";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNum(obj: unknown, path: string): number | null {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

const DRY_RUN = process.argv.includes("--dry-run");

interface Counters {
  scanned: number;
  inserted: number;
  linked: number;
  skipped: number;
}

function newCounters(): Counters {
  return { scanned: 0, inserted: 0, linked: 0, skipped: 0 };
}

function report(label: string, c: Counters): void {
  console.log(
    `  ${chalk.cyan(label.padEnd(16))} scanned=${c.scanned}  inserted=${c.inserted}  linked=${c.linked}  skipped=${c.skipped}`,
  );
}

// ─── Per-dimension backfills ─────────────────────────────────────────────────

async function backfillDerivatives(): Promise<Counters> {
  const c = newCounters();
  const rows = await prisma.derivativesDimension.findMany({
    include: { brief: { select: { asset: true, timestamp: true } } },
  });
  for (const r of rows) {
    c.scanned++;
    if (r.snapshotId) {
      c.skipped++;
      continue;
    }
    const ctx = r.context as Record<string, unknown>;
    const data = {
      asset: r.brief.asset,
      timestamp: r.brief.timestamp,
      regime: r.regime,
      stress: r.stress,
      previousRegime: r.previousRegime,
      previousStress: r.previousStress,
      oiSignal: r.oiSignal,
      since: r.since,
      fundingPct1m: getNum(ctx, "signals.fundingPct1m"),
      oiZScore30d: getNum(ctx, "signals.oiZScore30d"),
      oiChange24h: getNum(ctx, "signals.oiChange24h"),
      oiChange7d: getNum(ctx, "signals.oiChange7d"),
      liqPct1m: getNum(ctx, "signals.liqPct1m"),
      fundingPressureCycles: getNum(ctx, "signals.fundingPressureCycles"),
      fundingCurrent: getNum(ctx, "funding.current"),
      fundingPercentile1m: getNum(ctx, "funding.percentile.1m"),
      oiCurrent: getNum(ctx, "openInterest.current"),
      oiPercentile1m: getNum(ctx, "openInterest.percentile.1m"),
      liq8h: getNum(ctx, "liquidations.current8h"),
      cbPremiumCurrent: getNum(ctx, "coinbasePremium.current"),
      cbPremiumPercentile1m: getNum(ctx, "coinbasePremium.percentile.1m"),
      context: asJson(r.context),
    };
    if (DRY_RUN) {
      c.inserted++;
      continue;
    }
    const snap = await prisma.derivativesSnapshot.upsert({
      where: { asset_timestamp: { asset: r.brief.asset, timestamp: r.brief.timestamp } },
      create: data,
      update: { context: asJson(r.context) },
    });
    await prisma.derivativesDimension.update({ where: { id: r.id }, data: { snapshotId: snap.id } });
    c.inserted++;
    c.linked++;
  }
  return c;
}

async function backfillEtfs(): Promise<Counters> {
  const c = newCounters();
  const rows = await prisma.etfsDimension.findMany({
    include: { brief: { select: { asset: true, timestamp: true } } },
  });
  for (const r of rows) {
    c.scanned++;
    if (r.snapshotId) {
      c.skipped++;
      continue;
    }
    const ctx = r.context as Record<string, unknown>;
    const data = {
      asset: r.brief.asset,
      timestamp: r.brief.timestamp,
      regime: r.regime,
      previousRegime: r.previousRegime,
      since: r.since,
      flowTodaySigma: getNum(ctx, "flow.todaySigma"),
      flowPercentile1m: getNum(ctx, "flow.percentile1m"),
      flowToday: getNum(ctx, "flow.today"),
      flowD3Sum: getNum(ctx, "flow.d3Sum"),
      flowD7Sum: getNum(ctx, "flow.d7Sum"),
      consecutiveInflowDays: getNum(ctx, "flow.consecutiveInflowDays"),
      consecutiveOutflowDays: getNum(ctx, "flow.consecutiveOutflowDays"),
      reversalRatio: getNum(ctx, "flow.reversalRatio"),
      totalAumUsd: getNum(ctx, "totalAumUsd"),
      context: asJson(r.context),
    };
    if (DRY_RUN) {
      c.inserted++;
      continue;
    }
    const snap = await prisma.etfsSnapshot.upsert({
      where: { asset_timestamp: { asset: r.brief.asset, timestamp: r.brief.timestamp } },
      create: data,
      update: { context: asJson(r.context) },
    });
    await prisma.etfsDimension.update({ where: { id: r.id }, data: { snapshotId: snap.id } });
    c.inserted++;
    c.linked++;
  }
  return c;
}

async function backfillHtf(): Promise<Counters> {
  const c = newCounters();
  const rows = await prisma.htfDimension.findMany({
    include: { brief: { select: { asset: true, timestamp: true } } },
  });
  for (const r of rows) {
    c.scanned++;
    if (r.snapshotId) {
      c.skipped++;
      continue;
    }
    const ctx = r.context as Record<string, unknown>;
    const data = {
      asset: r.brief.asset,
      timestamp: r.brief.timestamp,
      regime: r.regime,
      previousRegime: r.previousRegime,
      since: r.since,
      lastStructure: r.lastStructure,
      snapshotPrice: r.snapshotPrice,
      priceVsSma50Pct: getNum(ctx, "ma.priceVsSma50Pct"),
      priceVsSma200Pct: getNum(ctx, "ma.priceVsSma200Pct"),
      rsiDaily: getNum(ctx, "rsi.daily"),
      rsiH4: getNum(ctx, "rsi.h4"),
      cvdFutShortSlope: getNum(ctx, "cvd.futures.short.slope"),
      cvdFutShortR2: getNum(ctx, "cvd.futures.short.r2"),
      cvdFutLongSlope: getNum(ctx, "cvd.futures.long.slope"),
      cvdSpotShortSlope: getNum(ctx, "cvd.spot.short.slope"),
      cvdSpotLongSlope: getNum(ctx, "cvd.spot.long.slope"),
      atrPercentile: getNum(ctx, "volatility.atrPercentile"),
      atrRatio: getNum(ctx, "volatility.atrRatio"),
      recentDisplacement: getNum(ctx, "volatility.recentDisplacement"),
      priceVsPocPct: getNum(ctx, "volumeProfile.near.priceVsPocPct"),
      context: asJson(r.context),
    };
    if (DRY_RUN) {
      c.inserted++;
      continue;
    }
    const snap = await prisma.htfSnapshot.upsert({
      where: { asset_timestamp: { asset: r.brief.asset, timestamp: r.brief.timestamp } },
      create: data,
      update: { context: asJson(r.context) },
    });
    await prisma.htfDimension.update({ where: { id: r.id }, data: { snapshotId: snap.id } });
    c.inserted++;
    c.linked++;
  }
  return c;
}

async function backfillSentiment(): Promise<Counters> {
  const c = newCounters();
  const rows = await prisma.sentimentDimension.findMany({
    include: { brief: { select: { asset: true, timestamp: true } } },
  });
  for (const r of rows) {
    c.scanned++;
    if (r.snapshotId) {
      c.skipped++;
      continue;
    }
    const ctx = r.context as Record<string, unknown>;
    const data = {
      asset: r.brief.asset,
      timestamp: r.brief.timestamp,
      regime: r.regime,
      previousRegime: r.previousRegime,
      since: r.since,
      compositeIndex: r.compositeIndex,
      compositeLabel: r.compositeLabel,
      positioning: r.positioning,
      trend: r.trend,
      momentumDivergence: getNum(ctx, "metrics.components.momentumDivergence"),
      institutionalFlows: r.institutionalFlows,
      exchangeFlows: r.exchangeFlows,
      expertConsensus: r.expertConsensus,
      consensusIndex: getNum(ctx, "metrics.consensusIndex"),
      sentZScore: getNum(ctx, "metrics.zScore"),
      bullishRatio: getNum(ctx, "metrics.bullishRatio"),
      context: asJson(r.context),
    };
    if (DRY_RUN) {
      c.inserted++;
      continue;
    }
    const snap = await prisma.sentimentSnapshot.upsert({
      where: { asset_timestamp: { asset: r.brief.asset, timestamp: r.brief.timestamp } },
      create: data,
      update: { context: asJson(r.context) },
    });
    await prisma.sentimentDimension.update({ where: { id: r.id }, data: { snapshotId: snap.id } });
    c.inserted++;
    c.linked++;
  }
  return c;
}

async function backfillExchangeFlows(): Promise<Counters> {
  const c = newCounters();
  const rows = await prisma.exchangeFlowsDimension.findMany({
    include: { brief: { select: { asset: true, timestamp: true } } },
  });
  for (const r of rows) {
    c.scanned++;
    if (r.snapshotId) {
      c.skipped++;
      continue;
    }
    const ctx = r.context as Record<string, unknown>;
    const data = {
      asset: r.brief.asset,
      timestamp: r.brief.timestamp,
      regime: r.regime,
      previousRegime: r.previousRegime,
      since: r.since,
      flowTodaySigma: getNum(ctx, "metrics.todaySigma"),
      flowPercentile1m: getNum(ctx, "metrics.flowPercentile1m"),
      reserveChange1dPct: getNum(ctx, "metrics.reserveChange1dPct"),
      reserveChange7dPct: getNum(ctx, "metrics.reserveChange7dPct"),
      reserveChange30dPct: getNum(ctx, "metrics.reserveChange30dPct"),
      netFlow1d: getNum(ctx, "metrics.netFlow1d"),
      netFlow7d: getNum(ctx, "metrics.netFlow7d"),
      context: asJson(r.context),
    };
    if (DRY_RUN) {
      c.inserted++;
      continue;
    }
    const snap = await prisma.exchangeFlowsSnapshot.upsert({
      where: { asset_timestamp: { asset: r.brief.asset, timestamp: r.brief.timestamp } },
      create: data,
      update: { context: asJson(r.context) },
    });
    await prisma.exchangeFlowsDimension.update({ where: { id: r.id }, data: { snapshotId: snap.id } });
    c.inserted++;
    c.linked++;
  }
  return c;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("\nBackfill snapshot tables from brief_<dim>"));
  if (DRY_RUN) console.log(chalk.yellow("  DRY RUN — no writes\n"));
  else console.log("");

  const derivatives = await backfillDerivatives();
  report("derivatives", derivatives);
  const etfs = await backfillEtfs();
  report("etfs", etfs);
  const htf = await backfillHtf();
  report("htf", htf);
  const sentiment = await backfillSentiment();
  report("sentiment", sentiment);
  const exchangeFlows = await backfillExchangeFlows();
  report("exchange_flows", exchangeFlows);

  console.log(chalk.green.bold("\nDone."));
  if (DRY_RUN) console.log(chalk.dim("Re-run without --dry-run to apply."));
}

main()
  .catch((e) => {
    console.error(chalk.red.bold("\nBackfill failed:"), e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
