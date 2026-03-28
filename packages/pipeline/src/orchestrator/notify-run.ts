/**
 * Notify Run — Resumable pipeline state tracking.
 *
 * Each `runNotify` invocation creates a `NotifyRun` record that tracks
 * which stage was last completed and caches intermediate artifacts so
 * that a failed run can be resumed without re-running expensive stages.
 */

import { prisma } from "../storage/db.js";
import type { $Enums } from "../generated/prisma/client.js";
import type { DimensionOutput } from "./types.js";
import type { TradeDecision } from "./trade-idea/index.js";
import type { RichBrief } from "./rich-synthesizer.js";

// ─── Artifact shape stored in the JSON column ───────────────────────────────

export interface RunArtifacts {
  outputs?: DimensionOutput[];
  decision?: TradeDecision | null;
  briefId?: string;
  richBrief?: RichBrief | null;
  briefText?: string;
  briefUrl?: string;
  tweetText?: string;
}

export type NotifyStage = $Enums.NotifyStage;

export const STAGES: NotifyStage[] = [
  "DIMENSIONS",
  "TRADE_IDEA",
  "SYNTHESIS",
  "PERSIST",
  "TELEGRAM",
  "TWITTER",
];

// ─── Lifecycle helpers ──────────────────────────────────────────────────────

export async function createRun(asset: $Enums.Asset): Promise<string> {
  const run = await prisma.notifyRun.create({ data: { asset } });
  return run.id;
}

export async function markStageCompleted(
  runId: string,
  stage: NotifyStage,
  artifacts: RunArtifacts,
): Promise<void> {
  await prisma.notifyRun.update({
    where: { id: runId },
    data: {
      lastCompleted: stage,
      failedStage: null,
      error: null,
      artifacts: JSON.parse(JSON.stringify(artifacts)),
      briefId: artifacts.briefId ?? undefined,
    },
  });
}

export async function markFailed(
  runId: string,
  stage: NotifyStage,
  error: string,
): Promise<void> {
  await prisma.notifyRun.update({
    where: { id: runId },
    data: { status: "FAILED", failedStage: stage, error },
  });
}

export async function markCompleted(runId: string): Promise<void> {
  await prisma.notifyRun.update({
    where: { id: runId },
    data: { status: "COMPLETED" },
  });
}

export interface LoadedRun {
  id: string;
  asset: $Enums.Asset;
  lastCompleted: NotifyStage | null;
  artifacts: RunArtifacts;
  createdAt: Date;
}

export async function loadRun(runId: string): Promise<LoadedRun> {
  const run = await prisma.notifyRun.findUniqueOrThrow({ where: { id: runId } });
  return {
    id: run.id,
    asset: run.asset,
    lastCompleted: run.lastCompleted,
    artifacts: (run.artifacts as RunArtifacts) ?? {},
    createdAt: run.createdAt,
  };
}

export async function listFailedRuns(): Promise<
  { id: string; asset: string; failedStage: string | null; error: string | null; createdAt: Date }[]
> {
  return prisma.notifyRun.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, asset: true, failedStage: true, error: true, createdAt: true },
  });
}
