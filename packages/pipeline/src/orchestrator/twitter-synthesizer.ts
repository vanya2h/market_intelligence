/**
 * Twitter Tweet Synthesizer
 *
 * Takes dimension outputs and produces a single punchy tweet
 * for crypto Twitter, preserving the key analytical signal.
 *
 * Cached by content-hash (1h TTL).
 */

import crypto from "node:crypto";
import { callLlm } from "../llm.js";
import { getCached } from "../storage/cache.js";
import type { AssetType } from "../types.js";
import type { DeltaSummary } from "./delta.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";

const CACHE_TTL = 1 * 60 * 60 * 1000;
const MAX_TWEET_LENGTH = 280;

function buildCacheKey(asset: string, outputs: DimensionOutput[], delta: DeltaSummary | null): string {
  const fingerprint = outputs.map((o) => ({
    dim: o.dimension,
    regime: o.regime,
    interp: o.interpretation.slice(0, 100),
  }));
  const deltaKey = delta ? { tier: delta.tier, changeSummary: delta.changeSummary } : null;
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ asset, fingerprint, channel: "twitter", deltaKey }))
    .digest("hex")
    .slice(0, 12);
  return `twitter-${asset.toLowerCase()}-${hash}`;
}

export function buildPrompt(asset: AssetType, outputs: DimensionOutput[], delta: DeltaSummary | null): string {
  const sections = outputs.map((o) => {
    return `### ${DIMENSION_LABELS[o.dimension]}
Regime: ${o.regime}
${o.interpretation}`;
  });

  const deltaSection =
    delta && delta.tier !== "low"
      ? `\n\n---\n\n### What changed since last tweet\n${delta.changeSummary}\n\nIMPORTANT: Your tweet must be about these changes only. Don't rehash what hasn't moved.`
      : "";

  return `${asset} | ${new Date().toUTCString()}

${sections.join("\n\n")}${deltaSection}`;
}

async function callClaude(
  asset: AssetType,
  outputs: DimensionOutput[],
  briefUrl?: string,
  delta: DeltaSummary | null = null,
): Promise<string> {
  const urlBudget = briefUrl ? briefUrl.length + 2 : 0; // +2 for "\n\n"
  const charLimit = MAX_TWEET_LENGTH - urlBudget - 10; // 10 char safety margin

  const isDelta = delta !== null && delta.tier !== "low";

  const deltaInstructions = isDelta
    ? `\n\nDELTA MODE: Followers already saw the previous tweet. Lead with what just changed — not what's been true for hours. If only one thing shifted, one sharp sentence is enough.`
    : "";

  const res = await callLlm({
    system: `You write a single ${asset} market tweet (max ${charLimit} chars). Your audience is crypto traders who want a quick, clear read on what's happening and what to watch.${deltaInstructions}

Structure:
1. Open with what ${asset} is doing right now and the key price level (e.g. "BTC rejected at $87k — sellers defending this level hard")
2. Explain WHY in plain English — what's driving the move? Use cause-and-effect, not just listing signals.
3. Close with what comes next — what level or event decides the next move?

Clarity rules:
- Write like you're explaining to a smart friend, not a terminal. Every sentence should be immediately understandable.
- BAD: "shorts pile in at consensus levels" — vague, what does this mean?
- GOOD: "most traders are betting on a drop, which often sets up a squeeze"
- Use exact prices for levels. For everything else, describe what it means rather than citing the number.
- No jargon without context. If you mention funding rate, say what it implies. If you mention OI, say what the positioning tells us.
- No hashtags, no emojis, no cashtags except for the asset price.
- Keep it punchy. Short sentences. Use → • | for structure.
- HARD LIMIT: your tweet MUST be under ${charLimit} characters. Finish your thought cleanly within this limit.
- Return ONLY the tweet text, nothing else.`,
    user: buildPrompt(asset, outputs, delta),
    maxTokens: 256,
  });

  let tweet = res.text.trim();
  if (tweet.length > charLimit) {
    // Trim to last sentence boundary that fits
    const truncated = tweet.slice(0, charLimit - 1);
    const lastBreak = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf(" — "),
      truncated.lastIndexOf(" • "),
      truncated.lastIndexOf("\n"),
    );
    tweet = lastBreak > charLimit * 0.5 ? truncated.slice(0, lastBreak + 1).trimEnd() : truncated + "…";
  }
  return tweet;
}

export async function synthesizeTweet(
  asset: AssetType,
  outputs: DimensionOutput[],
  briefUrl?: string,
  delta: DeltaSummary | null = null,
): Promise<string | null> {
  if (outputs.length === 0) {
    return null;
  }

  // Low significance → nothing new worth tweeting
  if (delta && delta.tier === "low") {
    return null;
  }

  const tweet = await getCached(buildCacheKey(asset, outputs, delta), CACHE_TTL, () =>
    callClaude(asset, outputs, briefUrl, delta),
  );

  return briefUrl ? `${tweet}\n\n${briefUrl}` : tweet;
}
