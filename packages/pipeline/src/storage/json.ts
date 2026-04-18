/**
 * Postgres-backed state and snapshot storage (via Prisma).
 *
 * DimensionState column mapping for the derivatives dimension:
 *   regime         → PositioningState  (e.g. "CROWDED_LONG")
 *   stress         → StressState       (e.g. "STRESS_NONE")
 *   previousRegime → previous PositioningState
 *   previousStress → previous StressState
 */

import type { AssetType, DerivativesSnapshot, DerivativesState, PositioningState } from "../types.js";
import { prisma } from "./db.js";

const MAX_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

// ─── History ─────────────────────────────────────────────────────────────────

export async function loadHistory(asset: AssetType): Promise<DerivativesSnapshot[]> {
  const rows = await prisma.dimensionSnapshot.findMany({
    where: { asset, dimension: "DERIVATIVES" },
    orderBy: { timestamp: "asc" },
  });
  return rows.map((r) => r.data as unknown as DerivativesSnapshot);
}

export async function appendSnapshot(asset: AssetType, snapshot: DerivativesSnapshot): Promise<DerivativesSnapshot[]> {
  await prisma.dimensionSnapshot.create({
    data: {
      asset,
      dimension: "DERIVATIVES",
      timestamp: new Date(snapshot.timestamp),
      data: JSON.parse(JSON.stringify(snapshot)),
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

export async function loadState(asset: AssetType): Promise<DerivativesState | null> {
  const row = await prisma.dimensionState.findUnique({
    where: { asset_dimension: { asset, dimension: "DERIVATIVES" } },
  });
  if (!row) return null;

  return {
    asset: row.asset,
    positioning: row.regime as PositioningState,
    stress: (row.stress as DerivativesState["stress"]) ?? null,
    since: row.since.toISOString(),
    previousPositioning: (row.previousRegime as PositioningState) ?? null,
    previousStress: (row.previousStress as DerivativesState["previousStress"]) ?? null,
    lastUpdated: row.lastUpdated.toISOString(),
  };
}

export async function saveState(asset: AssetType, state: DerivativesState): Promise<void> {
  await prisma.dimensionState.upsert({
    where: { asset_dimension: { asset, dimension: "DERIVATIVES" } },
    update: {
      regime: state.positioning,
      stress: state.stress,
      since: new Date(state.since),
      previousRegime: state.previousPositioning,
      previousStress: state.previousStress,
    },
    create: {
      asset,
      dimension: "DERIVATIVES",
      regime: state.positioning,
      stress: state.stress,
      since: new Date(state.since),
      previousRegime: state.previousPositioning,
      previousStress: state.previousStress,
    },
  });
}
