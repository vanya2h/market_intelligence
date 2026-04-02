/**
 * One-off test — re-synthesizes Telegram brief bypassing cache.
 * Shows previous brief alongside for delta comparison.
 * Usage: tsx src/scripts/test-telegram-prompt.ts [BTC|ETH]
 */
import "../env.js";
import { runAllDimensions } from "../orchestrator/pipeline.js";
import { buildPrompt, buildSystemPrompt } from "../orchestrator/synthesizer.js";
import { callLlm } from "../llm.js";
import { computeConfluence, computeConvictionThreshold } from "../orchestrator/trade-idea/confluence.js";
import { computeBias } from "../orchestrator/trade-idea/bias.js";
import { computeCompositeTarget, type Direction } from "../orchestrator/trade-idea/composite-target.js";
import type { TradeDecision } from "../orchestrator/trade-idea/index.js";
import type { HtfOutput } from "../orchestrator/types.js";
import { computeDelta } from "../orchestrator/delta.js";
import { prisma } from "../storage/db.js";

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  console.log(`\n⏳ Running ${asset} dimensions...`);

  const [outputs, prevBrief] = await Promise.all([
    runAllDimensions(asset),
    prisma.brief.findFirst({
      where: { asset },
      orderBy: { timestamp: "desc" },
      select: { id: true, timestamp: true, brief: true },
    }),
  ]);

  const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  let decision: TradeDecision | null = null;
  if (htfOut) {
    const threshold = computeConvictionThreshold(htfOut.context);
    const directions: Direction[] = ["LONG", "SHORT", "FLAT"];
    const scored = directions.map((dir) => ({
      direction: dir,
      confluence: computeConfluence(outputs, dir),
    }));
    const directional = scored
      .filter((s) => s.direction !== "FLAT")
      .sort((a, b) => b.confluence.total - a.confluence.total);
    const best = directional[0]!;
    const flat = scored.find((s) => s.direction === "FLAT")!;
    const chosen = best.confluence.total >= threshold ? best : flat;
    const skipped = chosen.direction !== "FLAT" ? false : best.confluence.total < threshold;
    const track = skipped ? best : chosen;
    const { entryPrice, compositeTarget } = computeCompositeTarget(htfOut.context, track.direction);
    const longConf = scored.find((s) => s.direction === "LONG")!.confluence;
    const shortConf = scored.find((s) => s.direction === "SHORT")!.confluence;
    const bias = computeBias(longConf, shortConf);

    decision = {
      direction: track.direction,
      confluence: track.confluence,
      entryPrice,
      compositeTarget,
      skipped,
      threshold,
      alternatives: scored
        .filter((s) => s.direction !== track.direction)
        .map((s) => ({ direction: s.direction, total: s.confluence.total })),
      bias,
    };
  }

  // Delta analysis
  console.log(`📊 Computing delta against previous brief...`);
  const delta = await computeDelta(asset, outputs);
  const tierLabel = delta.tier === "high" ? "🔴 HIGH" : delta.tier === "medium" ? "🟡 MEDIUM" : "🟢 LOW";
  console.log(`   Tier: ${tierLabel} (maxZ=${delta.maxZ === Infinity ? "∞" : delta.maxZ.toFixed(2)})`);
  if (delta.changeSummary) console.log(`   Changes: ${delta.changeSummary}`);
  if (delta.topTension) console.log(`   Tension: ${delta.topTension}`);

  const sep = "─".repeat(60);

  if (prevBrief) {
    console.log(`\n📄 PREVIOUS BRIEF ${`(${prevBrief.timestamp.toISOString().slice(0, 16)})`}`);
    console.log(sep);
    console.log(prevBrief.brief);
    console.log(sep);
  }

  if (delta.tier === "low") {
    const htfPrice = htfOut?.context.price;
    const priceStr = htfPrice ? ` at $${htfPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "";
    const oneLiner = `${asset}${priceStr} — no dramatic changes since last brief. ${delta.topTension}.`;
    console.log(`\n🟢 NEW BRIEF — one-liner (no LLM call):\n`);
    console.log(sep);
    console.log(oneLiner);
    console.log(sep);
    console.log(`${oneLiner.split(/\s+/).length} words · ${oneLiner.length} chars · 0s (deterministic)`);
  } else {
    const isDelta = true;
    console.log(`\n🔥 NEW BRIEF — calling LLM directly (no cache) [${delta.tier.toUpperCase()} DELTA]...\n`);
    const start = Date.now();
    const res = await callLlm({
      system: buildSystemPrompt(decision, isDelta),
      user: buildPrompt(asset, outputs, decision, delta),
      maxTokens: 450,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(sep);
    console.log(res.text);
    console.log(sep);
    console.log(`${res.text.split(/\s+/).length} words · ${res.text.length} chars · ${elapsed}s`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
