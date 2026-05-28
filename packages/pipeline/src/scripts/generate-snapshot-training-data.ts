/**
 * Generate cross-dimension snapshot training data for the snapshot ML model.
 *
 * For each HtfSnapshot with a recorded price, joins contemporaneous snapshots
 * from all other dimensions, extracts the canonical feature vector via
 * extractRawFeatures(), and looks up forward prices at multiple horizons from
 * subsequent HtfSnapshot rows.
 *
 * Output: packages/pipeline/training/snapshot_training_{asset}.csv
 *
 * Usage:
 *   tsx src/scripts/generate-snapshot-training-data.ts             # BTC
 *   tsx src/scripts/generate-snapshot-training-data.ts --asset ETH
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EtfContext } from "../etfs/types.js";
import type { ExchangeFlowsContext } from "../exchange_flows/types.js";
import type { HtfContext } from "../htf/types.js";
import { extractRawFeatures } from "../orchestrator/trade-idea/extract-features.js";
import type {
  DerivativesOutput,
  DimensionOutput,
  EtfsOutput,
  ExchangeFlowsOutput,
  HtfOutput,
} from "../orchestrator/types.js";
import { prisma } from "../storage/db.js";
import type { DerivativesContext } from "../types.js";
import { parseAsset } from "./utils.js";
import "../env.js";

const HORIZONS = [24, 48, 72, 168]; // hours — all stored in one CSV; trainer picks its horizon
const FORWARD_TOLERANCE_MS = 4 * 3600_000; // ±4h when looking for a future snapshot price

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

// ─── Binary-search helpers ────────────────────────────────────────────────────

/** Latest row with timestamp ≤ ts, or null. Sorted ascending by timestamp. */
function latestBefore<T extends { timestamp: Date }>(sorted: T[], ts: number): T | null {
  let lo = 0,
    hi = sorted.length - 1,
    result: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.timestamp.getTime() <= ts) {
      result = sorted[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** Closest row to targetMs within ±toleranceMs, or null. */
function nearestTo<T extends { timestamp: Date }>(sorted: T[], targetMs: number, toleranceMs: number): T | null {
  let lo = 0,
    hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.timestamp.getTime() < targetMs) lo = mid + 1;
    else hi = mid;
  }
  let best: T | null = null,
    bestDist = Infinity;
  for (let i = Math.max(0, lo - 2); i <= Math.min(sorted.length - 1, lo + 2); i++) {
    const dist = Math.abs(sorted[i]!.timestamp.getTime() - targetMs);
    if (dist <= toleranceMs && dist < bestDist) {
      bestDist = dist;
      best = sorted[i]!;
    }
  }
  return best;
}

// ─── Snapshot → DimensionOutput adapters ─────────────────────────────────────

type DerivativesRow = Awaited<ReturnType<typeof prisma.derivativesSnapshot.findMany>>[number];
type EtfsRow = Awaited<ReturnType<typeof prisma.etfsSnapshot.findMany>>[number];
type HtfRow = Awaited<ReturnType<typeof prisma.htfSnapshot.findMany>>[number];
type EfRow = Awaited<ReturnType<typeof prisma.exchangeFlowsSnapshot.findMany>>[number];

function toDerivativesOutput(row: DerivativesRow): DerivativesOutput {
  return {
    dimension: "DERIVATIVES",
    snapshotId: row.id,
    regime: row.regime,
    stress: row.stress,
    previousRegime: row.previousRegime,
    previousStress: row.previousStress,
    oiSignal: row.oiSignal ?? "OI_NORMAL",
    since: row.since.toISOString(),
    context: row.context as unknown as DerivativesContext,
    interpretation: "",
  };
}

function toEtfsOutput(row: EtfsRow): EtfsOutput {
  return {
    dimension: "ETFS",
    snapshotId: row.id,
    regime: row.regime,
    previousRegime: row.previousRegime,
    since: row.since.toISOString(),
    context: row.context as unknown as EtfContext,
    interpretation: "",
  };
}

function toHtfOutput(row: HtfRow): HtfOutput {
  return {
    dimension: "HTF",
    snapshotId: row.id,
    regime: row.regime,
    previousRegime: row.previousRegime,
    since: row.since.toISOString(),
    lastStructure: row.lastStructure,
    snapshotPrice: row.snapshotPrice,
    context: row.context as unknown as HtfContext,
    interpretation: "",
  };
}

function toExchangeFlowsOutput(row: EfRow): ExchangeFlowsOutput {
  return {
    dimension: "EXCHANGE_FLOWS",
    snapshotId: row.id,
    regime: row.regime,
    previousRegime: row.previousRegime,
    since: row.since.toISOString(),
    context: row.context as unknown as ExchangeFlowsContext,
    interpretation: "",
  };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = row[h];
          if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
          if (v == null) return "";
          return String(v);
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const asset = parseAsset();
  console.log(`\nGenerating snapshot training data for ${asset}…\n`);

  // Load all snapshots for the asset, sorted ascending by timestamp
  const [htfRows, derivRows, etfRows, efRows] = await Promise.all([
    prisma.htfSnapshot.findMany({ where: { asset }, orderBy: { timestamp: "asc" } }),
    prisma.derivativesSnapshot.findMany({ where: { asset }, orderBy: { timestamp: "asc" } }),
    prisma.etfsSnapshot.findMany({ where: { asset }, orderBy: { timestamp: "asc" } }),
    prisma.exchangeFlowsSnapshot.findMany({ where: { asset }, orderBy: { timestamp: "asc" } }),
  ]);

  // Only HTF snapshots with a recorded price can serve as anchor or forward-price lookups
  const pricedHtf = htfRows.filter((r) => r.snapshotPrice != null);

  console.log(`  HtfSnapshot total       : ${htfRows.length}  (with price: ${pricedHtf.length})`);
  console.log(`  DerivativesSnapshot     : ${derivRows.length}`);
  console.log(`  EtfsSnapshot            : ${etfRows.length}`);
  console.log(`  ExchangeFlowsSnapshot   : ${efRows.length}\n`);

  const outputRows: Record<string, unknown>[] = [];
  let skippedMissingForward = 0;
  let skippedMissingContext = 0;

  for (const htf of pricedHtf) {
    const ts = htf.timestamp.getTime();

    // Build dimension outputs from the contemporaneous snapshots
    const outputs: DimensionOutput[] = [toHtfOutput(htf)];

    const deriv = latestBefore(derivRows, ts);
    if (deriv) outputs.push(toDerivativesOutput(deriv));

    const etf = latestBefore(etfRows, ts);
    if (etf) outputs.push(toEtfsOutput(etf));

    const ef = latestBefore(efRows, ts);
    if (ef) outputs.push(toExchangeFlowsOutput(ef));

    // Skip rows that are missing too many dimensions (no useful signal)
    if (outputs.length < 2) {
      skippedMissingContext++;
      continue;
    }

    const features = extractRawFeatures(outputs, htf.timestamp);

    // Flatten features: {DIM}_{key} → value
    const featureRow: Record<string, number> = {};
    for (const dim of ["DERIVATIVES", "ETFS", "HTF", "EXCHANGE_FLOWS"] as const) {
      for (const [key, val] of Object.entries(features[dim])) {
        featureRow[`${dim}_${key}`] = val;
      }
    }

    // One row per horizon
    for (const horizon of HORIZONS) {
      const futureMs = ts + horizon * 3600_000;
      const futureHtf = nearestTo(pricedHtf, futureMs, FORWARD_TOLERANCE_MS);
      if (!futureHtf?.snapshotPrice) {
        skippedMissingForward++;
        continue;
      }

      const returnPct = (futureHtf.snapshotPrice - htf.snapshotPrice!) / htf.snapshotPrice!;

      outputRows.push({
        timestamp: htf.timestamp.toISOString(),
        asset,
        horizon_hours: horizon,
        price_now: htf.snapshotPrice,
        price_future: futureHtf.snapshotPrice,
        return_pct: returnPct,
        ...featureRow,
      });
    }
  }

  console.log(`  Rows generated          : ${outputRows.length}`);
  console.log(`  Skipped (no forward)    : ${skippedMissingForward}`);
  console.log(`  Skipped (no context)    : ${skippedMissingContext}`);

  if (outputRows.length === 0) {
    console.log("\n  No rows — nothing to write.");
    return;
  }

  const outPath = resolve(
    REPO_ROOT,
    "packages",
    "pipeline",
    "training",
    `snapshot_training_${asset.toLowerCase()}.csv`,
  );
  writeFileSync(outPath, toCSV(outputRows));
  console.log(`\n  Written → ${outPath}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
