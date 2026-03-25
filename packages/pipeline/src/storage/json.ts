/**
 * Postgres-backed state and snapshot storage (via Prisma).
 *
 * Drop-in replacement for the previous file-based json.ts.
 * Used by the derivatives dimension (Dimension 01).
 */

import { prisma } from "./db.js";
import type { DerivativesSnapshot, DerivativesState } from "../types.js";

const MAX_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

// ─── History ────────────────────────────────────────────────────────────────

export async function loadHistory(asset: "BTC" | "ETH"): Promise<DerivativesSnapshot[]> {
  const rows = await prisma.dimensionSnapshot.findMany({
    where: { asset, dimension: "DERIVATIVES" },
    orderBy: { timestamp: "asc" },
  });
  return rows.map((r) => r.data as unknown as DerivativesSnapshot);
}

export async function appendSnapshot(asset: "BTC" | "ETH", snapshot: DerivativesSnapshot): Promise<DerivativesSnapshot[]> {
  await prisma.dimensionSnapshot.create({
    data: {
      asset,
      dimension: "DERIVATIVES",
      timestamp: new Date(snapshot.timestamp),
      data: snapshot as any,
    },
  });

  // Prune entries older than 30 days
  const cutoff = new Date(Date.now() - MAX_HISTORY_MS);
  await prisma.dimensionSnapshot.deleteMany({
    where: {
      asset,
      dimension: "DERIVATIVES",
      timestamp: { lt: cutoff },
    },
  });

  return loadHistory(asset);
}

// ─── State ───────────────────────────────────────────────────────────────────

export async function loadState(asset: "BTC" | "ETH"): Promise<DerivativesState | null> {
  const row = await prisma.dimensionState.findUnique({
    where: { asset_dimension: { asset, dimension: "DERIVATIVES" } },
  });
  if (!row) return null;
  return {
    asset: row.asset,
    regime: row.regime as DerivativesState["regime"],
    since: row.since.toISOString(),
    previousRegime: row.previousRegime as DerivativesState["previousRegime"],
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

export async function saveState(asset: "BTC" | "ETH", state: DerivativesState): Promise<void> {
  await prisma.dimensionState.upsert({
    where: { asset_dimension: { asset, dimension: "DERIVATIVES" } },
    update: {
      regime: state.regime,
      since: new Date(state.since),
      previousRegime: state.previousRegime,
    },
    create: {
      asset,
      dimension: "DERIVATIVES",
      regime: state.regime,
      since: new Date(state.since),
      previousRegime: state.previousRegime,
    },
  });
}
