/**
 * ML Data Audit — count training data viability for L1 confluence aggregator.
 *
 * Usage:  tsx src/scripts/ml-data-audit.ts
 */

import chalk from "chalk";
import type { $Enums } from "../generated/prisma/client.js";
import { prisma } from "../storage/db.js";
import "../env.js";

interface ConfluenceShape {
  derivatives?: number;
  etfs?: number;
  htf?: number;
  exchangeFlows?: number;
  total?: number;
}

const ASSETS: $Enums.Asset[] = ["BTC", "ETH"];

async function auditAsset(asset: $Enums.Asset): Promise<void> {
  console.log(chalk.bold.cyan(`\n  ${asset}`));
  console.log(chalk.dim("  ─────────────────────────────────────────"));

  const total = await prisma.tradeIdea.count({ where: { asset } });
  const withReturns = await prisma.tradeIdea.count({
    where: { asset, returns: { some: {} } },
  });

  console.log(`  Total trade ideas:           ${chalk.bold(String(total))}`);
  console.log(`  With ≥1 return snapshot:     ${chalk.bold(String(withReturns))}`);

  if (withReturns === 0) {
    console.log(chalk.red("  No usable training data."));
    return;
  }

  const ideas = await prisma.tradeIdea.findMany({
    where: { asset, returns: { some: {} } },
    include: { returns: { orderBy: { hoursAfter: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  let usable = 0;
  let wins = 0;
  let losses = 0;
  let hasAllDims = 0;
  const qualityValues: number[] = [];
  const firstDate = ideas[0]?.createdAt;
  const lastDate = ideas[ideas.length - 1]?.createdAt;

  for (const idea of ideas) {
    const conf = idea.confluence as ConfluenceShape | null;
    if (!conf) continue;

    const allDims =
      typeof conf.derivatives === "number" &&
      typeof conf.etfs === "number" &&
      typeof conf.htf === "number" &&
      typeof conf.exchangeFlows === "number";
    if (allDims) hasAllDims++;

    if (idea.returns.length === 0) continue;

    const peak = idea.returns.reduce((best, r) =>
      Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best,
    );

    if (allDims) {
      usable++;
      qualityValues.push(peak.qualityAtPoint);
      if (peak.qualityAtPoint > 0) wins++;
      else losses++;
    }
  }

  console.log(`  Has all 4 dim scores:        ${chalk.bold(String(hasAllDims))}`);
  console.log(`  Fully usable rows (X+y):     ${chalk.bold(String(usable))}`);

  if (firstDate && lastDate) {
    const days = Math.round((+lastDate - +firstDate) / (1000 * 60 * 60 * 24));
    console.log(
      `  Date range:                  ${firstDate.toISOString().slice(0, 10)} → ${lastDate.toISOString().slice(0, 10)} (${days}d)`,
    );
  }

  if (usable > 0) {
    const winRate = (wins / usable) * 100;
    const balance = Math.min(wins, losses) / Math.max(wins, losses);
    const meanQ = qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length;

    const balanceColor = balance >= 0.6 ? chalk.green : balance >= 0.4 ? chalk.yellow : chalk.red;
    console.log(
      `  Class balance (win/loss):    ${wins}/${losses} (${winRate.toFixed(1)}% wins, ${balanceColor(`balance=${balance.toFixed(2)}`)})`,
    );
    console.log(`  Mean qualityAtPoint:         ${meanQ >= 0 ? "+" : ""}${meanQ.toFixed(3)}`);

    // Viability verdict
    let verdict: string;
    if (usable >= 100) verdict = chalk.green.bold("✓ VIABLE for L1 (logistic regression)");
    else if (usable >= 50) verdict = chalk.yellow.bold("⚠ MARGINAL — train but expect high variance");
    else if (usable >= 20)
      verdict = chalk.red("⚠ MINIMAL — heavy regularization required, treat results as exploratory");
    else verdict = chalk.red.bold("✗ INSUFFICIENT — collect more data before training");
    console.log(`  Verdict:                     ${verdict}`);
  }
}

async function main() {
  console.log(chalk.bold.cyan("\n  ML L1 Data Audit"));
  for (const asset of ASSETS) {
    await auditAsset(asset);
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red("Fatal:"), err);
    process.exit(1);
  });
