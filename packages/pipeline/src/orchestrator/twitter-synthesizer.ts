/**
 * Twitter Tweet Synthesizer
 *
 * Takes dimension outputs and produces a single punchy tweet
 * for crypto Twitter, preserving the key analytical signal.
 *
 * Cached by content-hash (1h TTL).
 */

import crypto from "node:crypto";
import { getCached } from "../storage/cache.js";
import { callLlm } from "../llm.js";
import { DIMENSION_LABELS, type DimensionOutput } from "./types.js";

const CACHE_TTL = 1 * 60 * 60 * 1000;
const MAX_TWEET_LENGTH = 280;

function buildCacheKey(asset: string, outputs: DimensionOutput[]): string {
  const fingerprint = outputs.map((o) => ({
    dim: o.dimension,
    regime: o.regime,
    interp: o.interpretation.slice(0, 100),
  }));
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ asset, fingerprint, channel: "twitter" }))
    .digest("hex")
    .slice(0, 12);
  return `twitter-${asset.toLowerCase()}-${hash}`;
}

function buildPrompt(asset: "BTC" | "ETH", outputs: DimensionOutput[]): string {
  const sections = outputs.map((o) => {
    return `### ${DIMENSION_LABELS[o.dimension]}
Regime: ${o.regime}
${o.interpretation}`;
  });

  return `${asset} | ${new Date().toUTCString()}

${sections.join("\n\n")}`;
}

async function callClaude(asset: "BTC" | "ETH", outputs: DimensionOutput[], briefUrl?: string): Promise<string> {
  const urlBudget = briefUrl ? briefUrl.length + 2 : 0; // +2 for "\n\n"
  const charLimit = MAX_TWEET_LENGTH - urlBudget;

  const res = await callLlm({
    system: `Crypto analyst writing ONE tweet (max ${charLimit} chars) about ${asset}. Swing-trade reversal focus.

Include: directional bias, key price level, 1-2 strongest signals (cite exact numbers: funding rate, RSI, F&G, flows).

Style: direct, data-heavy, no hashtags, no emojis. Use → • | for structure. Return ONLY the tweet text.`,
    user: buildPrompt(asset, outputs),
    maxTokens: 256,
  });

  let tweet = res.text.trim();
  if (tweet.length > charLimit) {
    tweet = tweet.slice(0, charLimit - 1) + "…";
  }
  return tweet;
}

export async function synthesizeTweet(
  asset: "BTC" | "ETH",
  outputs: DimensionOutput[],
  briefUrl?: string,
): Promise<string> {
  if (outputs.length === 0) {
    return "No dimension data available.";
  }

  const tweet = await getCached(buildCacheKey(asset, outputs), CACHE_TTL, () =>
    callClaude(asset, outputs, briefUrl),
  );

  return briefUrl ? `${tweet}\n\n${briefUrl}` : tweet;
}
