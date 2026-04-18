/**
 * One-off unblock for Prisma's migration advisory lock (72707369) when it's
 * orphaned on a PgBouncer-pooled backend. Re-checks the lock, terminates any
 * backend holding it, then re-checks to confirm release.
 *
 * This is a destructive action (kills PG backend connections) and should only
 * be run when the long-term `directUrl` fix isn't yet in place.
 */
import { prisma } from "../storage/db.js";
import "../env.js";

const PRISMA_MIGRATE_LOCK = 72707369n;

interface LockHolder {
  pid: number;
  granted: boolean;
  application_name: string | null;
  state: string | null;
  client_addr: string | null;
}

interface TerminateResult {
  pid: number;
  terminated: boolean;
}

async function probeLock(): Promise<LockHolder[]> {
  return prisma.$queryRaw<LockHolder[]>`
    SELECT
      l.pid,
      l.granted,
      a.application_name,
      a.state,
      a.client_addr::text AS client_addr
    FROM pg_locks l
    LEFT JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory'
      AND ((l.classid::bigint << 32) | l.objid::bigint) = ${PRISMA_MIGRATE_LOCK}
    ORDER BY l.granted DESC, l.pid;
  `;
}

async function main(): Promise<void> {
  console.log(`\nUnblocking Prisma migration lock ${PRISMA_MIGRATE_LOCK}\n`);

  // 1. Probe
  const before = await probeLock();
  if (before.length === 0) {
    console.log("✓ Lock is already free. Run `pnpm db:migrate` again.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`Holders before:`);
  for (const h of before) {
    console.log(
      `  pid=${h.pid}  ${h.granted ? "GRANTED" : "WAITING"}  app=${h.application_name ?? "—"}  state=${h.state ?? "—"}  addr=${h.client_addr ?? "—"}`,
    );
  }

  // 2. Terminate every backend that holds (not just waits on) the lock.
  const granted = before.filter((h) => h.granted);
  if (granted.length === 0) {
    console.log("\nNo backends GRANTED the lock — only waiters. Nothing to terminate.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nTerminating ${granted.length} backend(s)...`);
  for (const h of granted) {
    const rows = await prisma.$queryRaw<TerminateResult[]>`
      SELECT ${h.pid}::int AS pid, pg_terminate_backend(${h.pid}::int) AS terminated;
    `;
    const ok = rows[0]?.terminated === true;
    console.log(`  pid=${h.pid}  → ${ok ? "terminated" : "no-op (already gone)"}`);
  }

  // 3. Re-probe
  // Small delay so Postgres has a chance to process the SIGTERM and drop locks.
  await new Promise((r) => setTimeout(r, 250));
  const after = await probeLock();

  if (after.length === 0) {
    console.log("\n✓ Lock released. Run `pnpm db:migrate` again.\n");
  } else {
    console.log(`\n⚠ Lock still has ${after.length} holder(s) after termination:`);
    for (const h of after) {
      console.log(`  pid=${h.pid}  ${h.granted ? "GRANTED" : "WAITING"}`);
    }
    console.log("\nThe orphaned backend may have already been replaced — re-run this script.\n");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
