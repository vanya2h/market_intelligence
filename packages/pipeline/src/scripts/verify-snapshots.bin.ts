/**
 * Verify the snapshot backfill is consistent with the brief tables.
 *
 * Checks:
 *   1. Every brief_<dim> row has snapshotId set.
 *   2. snapshot row count >= brief_<dim> row count for each dim.
 *   3. Spot-check 5 random snapshots: regime + timestamp match the brief.
 *
 * Exits non-zero on any failure so it can gate CI / cutover steps.
 *
 * Usage:
 *   pnpm --filter @market-intel/pipeline verify:snapshots
 */

import chalk from "chalk";
import "../env.js";
import { prisma } from "../storage/db.js";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(label: string, ok: boolean, detail: string): void {
  checks.push({ label, ok, detail });
  const icon = ok ? chalk.green("✓") : chalk.red("✗");
  console.log(`  ${icon} ${label.padEnd(40)} ${chalk.dim(detail)}`);
}

async function checkLinked(
  label: string,
  count: () => Promise<{ unlinked: number; total: number }>,
): Promise<void> {
  const { unlinked, total } = await count();
  record(`${label}: all briefs linked`, unlinked === 0, `${total - unlinked}/${total} linked, ${unlinked} unlinked`);
}

async function checkRowCounts(
  label: string,
  briefCount: number,
  snapshotCount: number,
): Promise<void> {
  record(
    `${label}: snapshot rows >= brief rows`,
    snapshotCount >= briefCount,
    `briefs=${briefCount}, snapshots=${snapshotCount}`,
  );
}

async function spotCheckDerivatives(): Promise<void> {
  const sample = await prisma.derivativesDimension.findMany({
    where: { snapshotId: { not: null } },
    take: 5,
    include: { brief: { select: { asset: true, timestamp: true } }, snapshot: true },
    orderBy: { id: "desc" },
  });
  let mismatches = 0;
  for (const r of sample) {
    if (!r.snapshot) {
      mismatches++;
      continue;
    }
    if (r.snapshot.regime !== r.regime) mismatches++;
    if (r.snapshot.asset !== r.brief.asset) mismatches++;
    if (r.snapshot.timestamp.getTime() !== r.brief.timestamp.getTime()) mismatches++;
  }
  record("derivatives: spot-check (n=5)", mismatches === 0, `${sample.length} sampled, ${mismatches} mismatches`);
}

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("\nVerify snapshot backfill\n"));

  // 1. All brief_<dim> rows have snapshotId
  await checkLinked("derivatives", async () => ({
    unlinked: await prisma.derivativesDimension.count({ where: { snapshotId: null } }),
    total: await prisma.derivativesDimension.count(),
  }));
  await checkLinked("etfs", async () => ({
    unlinked: await prisma.etfsDimension.count({ where: { snapshotId: null } }),
    total: await prisma.etfsDimension.count(),
  }));
  await checkLinked("htf", async () => ({
    unlinked: await prisma.htfDimension.count({ where: { snapshotId: null } }),
    total: await prisma.htfDimension.count(),
  }));
  await checkLinked("sentiment", async () => ({
    unlinked: await prisma.sentimentDimension.count({ where: { snapshotId: null } }),
    total: await prisma.sentimentDimension.count(),
  }));
  await checkLinked("exchange_flows", async () => ({
    unlinked: await prisma.exchangeFlowsDimension.count({ where: { snapshotId: null } }),
    total: await prisma.exchangeFlowsDimension.count(),
  }));

  // 2. Row counts: snapshot >= brief (snapshot can be more once hourly job runs)
  await checkRowCounts("derivatives", await prisma.derivativesDimension.count(), await prisma.derivativesSnapshot.count());
  await checkRowCounts("etfs", await prisma.etfsDimension.count(), await prisma.etfsSnapshot.count());
  await checkRowCounts("htf", await prisma.htfDimension.count(), await prisma.htfSnapshot.count());
  await checkRowCounts("sentiment", await prisma.sentimentDimension.count(), await prisma.sentimentSnapshot.count());
  await checkRowCounts("exchange_flows", await prisma.exchangeFlowsDimension.count(), await prisma.exchangeFlowsSnapshot.count());

  // 3. Spot-check derivatives (other dims share the same backfill code path)
  await spotCheckDerivatives();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log(chalk.green.bold("\nAll checks passed.\n"));
    return;
  }
  console.log(chalk.red.bold(`\n${failed.length} check(s) failed.\n`));
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(chalk.red.bold("\nVerification crashed:"), e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
