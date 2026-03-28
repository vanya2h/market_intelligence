#!/usr/bin/env tsx
/**
 * Debug — inspect candle data around specific dates and displacement detection.
 */

import "../env.js";
import { collect } from "./collector.js";

async function main() {
  const snap = await collect("BTC");
  const candles = snap.futuresH4Candles;

  console.log(`Total candles: ${candles.length}`);
  console.log(`First candle: ${new Date(candles[0]!.time).toISOString()}`);
  console.log(`Last candle:  ${new Date(candles.at(-1)!.time).toISOString()}`);

  // Show candles around Feb 3-7
  console.log("\n── Candles around Feb 5 ──");
  for (const c of candles) {
    const d = new Date(c.time);
    if (d.getUTCMonth() === 1 && d.getUTCDate() >= 3 && d.getUTCDate() <= 7) {
      const move = Math.abs(c.close - c.open);
      console.log(
        `${d.toISOString().slice(0, 16)}  O:${c.open.toFixed(0)} H:${c.high.toFixed(0)} L:${c.low.toFixed(0)} C:${c.close.toFixed(0)}  |move|=$${move.toFixed(0)}  vol=${c.volume.toFixed(0)}`,
      );
    }
  }

  // Show what candle 146 from end is (current detected range start)
  const rangeIdx = candles.length - 146;
  console.log(`\n── Current range start (index ${rangeIdx}, 146 from end) ──`);
  for (let i = Math.max(0, rangeIdx - 3); i <= Math.min(candles.length - 1, rangeIdx + 3); i++) {
    const c = candles[i]!;
    const d = new Date(c.time);
    const move = Math.abs(c.close - c.open);
    const marker = i === rangeIdx ? " ◄◄◄ RANGE START" : "";
    console.log(
      `[${i}] ${d.toISOString().slice(0, 16)}  O:${c.open.toFixed(0)} H:${c.high.toFixed(0)} L:${c.low.toFixed(0)} C:${c.close.toFixed(0)}  |move|=$${move.toFixed(0)}${marker}`,
    );
  }

  // Show all large moves (>$2000) to understand displacement landscape
  console.log("\n── All single-candle moves > $2000 ──");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const move = Math.abs(c.close - c.open);
    if (move > 2000) {
      const d = new Date(c.time);
      const fromEnd = candles.length - i;
      console.log(
        `[${i}] ${d.toISOString().slice(0, 16)}  |move|=$${move.toFixed(0)}  (${fromEnd} candles from end, ~${(fromEnd * 4 / 24).toFixed(1)}d)`,
      );
    }
  }

  // Show all 3-candle window moves > $3000
  console.log("\n── All 3-candle window moves > $3000 ──");
  for (let i = 2; i < candles.length; i++) {
    const move = Math.abs(candles[i]!.close - candles[i - 2]!.close);
    if (move > 3000) {
      const d = new Date(candles[i]!.time);
      const fromEnd = candles.length - i;
      console.log(
        `[${i}] ${d.toISOString().slice(0, 16)}  |3c move|=$${move.toFixed(0)}  (${fromEnd} candles from end, ~${(fromEnd * 4 / 24).toFixed(1)}d)`,
      );
    }
  }

  console.log(`\nATR reference: ~$901, so 5×ATR ≈ $${(901 * 5).toFixed(0)}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
