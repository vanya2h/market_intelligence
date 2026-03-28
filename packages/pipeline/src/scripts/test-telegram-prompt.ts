/**
 * One-off test — re-synthesizes Telegram brief bypassing cache.
 * Usage: tsx src/scripts/test-telegram-prompt.ts [BTC|ETH]
 */
import "../env.js";
import { runAllDimensions } from "../orchestrator/pipeline.js";
import { synthesizeRich } from "../orchestrator/rich-synthesizer.js";
import { buildPrompt, buildSystemPrompt } from "../orchestrator/synthesizer.js";
import { callLlm } from "../llm.js";
import { computeConfluence, CONVICTION_THRESHOLD } from "../orchestrator/trade-idea/confluence.js";
import { computeCompositeTarget, type Direction } from "../orchestrator/trade-idea/composite-target.js";
import type { TradeDecision } from "../orchestrator/trade-idea/index.js";
import type { HtfOutput } from "../orchestrator/types.js";

async function main() {
  const asset = (process.argv[2]?.toUpperCase() ?? "BTC") as "BTC" | "ETH";
  console.log(`\n⏳ Running ${asset} dimensions...`);

  const outputs = await runAllDimensions(asset);
  const richBrief = await synthesizeRich(asset, outputs);

  const htfOut = outputs.find((o): o is HtfOutput => o.dimension === "HTF");
  let decision: TradeDecision | null = null;
  if (htfOut) {
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
    const chosen = best.confluence.total >= CONVICTION_THRESHOLD ? best : flat;
    const skipped = chosen.direction !== "FLAT" ? false : best.confluence.total < CONVICTION_THRESHOLD;
    const track = skipped ? best : chosen;
    const { entryPrice, compositeTarget } = computeCompositeTarget(htfOut.context, track.direction);
    decision = {
      direction: track.direction,
      confluence: track.confluence,
      entryPrice,
      compositeTarget,
      skipped,
      alternatives: scored
        .filter((s) => s.direction !== track.direction)
        .map((s) => ({ direction: s.direction, total: s.confluence.total })),
    };
  }

  console.log(`🔥 Calling LLM directly (no cache)...\n`);
  const start = Date.now();
  const res = await callLlm({
    system: buildSystemPrompt(decision),
    user: buildPrompt(asset, richBrief, outputs, decision),
    maxTokens: 326,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("─".repeat(60));
  console.log(res.text);
  console.log("─".repeat(60));
  console.log(`${res.text.split(/\s+/).length} words · ${res.text.length} chars · ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
