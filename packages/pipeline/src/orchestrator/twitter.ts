/**
 * Twitter/X Poster
 *
 * Posts a single tweet to Twitter/X using the v2 API.
 *
 * Env vars:
 *   TWITTER_API_KEY         — consumer / app key
 *   TWITTER_API_SECRET      — consumer / app secret
 *   TWITTER_ACCESS_TOKEN    — user access token
 *   TWITTER_ACCESS_SECRET   — user access token secret
 */

import { TwitterApi } from "twitter-api-v2";

// ─── Client ──────────────────────────────────────────────────────────────────

function getClient(): TwitterApi {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error(
      "Missing Twitter credentials. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET",
    );
  }

  return new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken,
    accessSecret,
  });
}

// ─── Post ────────────────────────────────────────────────────────────────────

export async function postTweet(text: string): Promise<string> {
  const client = getClient();
  const { data } = await client.v2.tweet(text);
  return data.id;
}
