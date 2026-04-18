/** Quick dump of recent BTC briefs with regimes to find interesting delta pairs. */

import { prisma } from "../storage/db.js";
import "../env.js";

async function main() {
  const briefs = await prisma.brief.findMany({
    where: { asset: "BTC" },
    orderBy: { timestamp: "desc" },
    take: 30,
    select: {
      id: true,
      timestamp: true,
      derivatives: { select: { regime: true } },
      etfs: { select: { regime: true } },
      htf: { select: { regime: true, snapshotPrice: true } },
      sentiment: { select: { regime: true, compositeIndex: true } },
      exchangeFlows: { select: { regime: true } },
    },
  });

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("ID", 28) +
      pad("Timestamp", 18) +
      pad("Deriv", 20) +
      pad("ETF", 20) +
      pad("HTF", 18) +
      pad("Price", 10) +
      pad("Sentiment", 22) +
      pad("F&G", 6) +
      "ExFlows",
  );
  console.log("─".repeat(150));

  for (const b of briefs) {
    const ts = b.timestamp.toISOString().slice(0, 16);
    console.log(
      pad(b.id, 28) +
        pad(ts, 18) +
        pad(b.derivatives?.regime ?? "-", 20) +
        pad(b.etfs?.regime ?? "-", 20) +
        pad(b.htf?.regime ?? "-", 18) +
        pad(b.htf?.snapshotPrice?.toFixed(0) ?? "-", 10) +
        pad(b.sentiment?.regime ?? "-", 22) +
        pad(b.sentiment?.compositeIndex?.toFixed(1) ?? "-", 6) +
        (b.exchangeFlows?.regime ?? "-"),
    );
  }

  await prisma.$disconnect();
}

main().catch(console.error);
