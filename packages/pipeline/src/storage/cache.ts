/**
 * Redis-backed API response cache (via Upstash).
 *
 * Drop-in replacement for the previous Prisma-based cache.
 * Each entry stored as JSON with a TTL set via Redis expiry.
 */

import chalk from "chalk";
import { formatDistanceToNowStrict } from "date-fns";
import { getRedis } from "./redis.js";

interface CacheEntry<T> {
  fetchedAt: number; // epoch ms
  data: T;
}

function formatAge(fetchedAt: number): string {
  return formatDistanceToNowStrict(new Date(fetchedAt), { addSuffix: true });
}

const KEY_PREFIX = "cache:";

export async function getCached<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
  const redisKey = `${KEY_PREFIX}${key}`;
  const redis = getRedis();
  const existing = await redis.get<CacheEntry<T>>(redisKey);

  if (existing) {
    const age = Date.now() - existing.fetchedAt;
    if (age < ttlMs) {
      console.log(
        `      ${chalk.green("▸ cache hit")}  ${chalk.cyan(key)} ${chalk.dim(`${formatAge(existing.fetchedAt)} old`)}`,
      );
      return existing.data;
    }
    console.log(
      `      ${chalk.yellow("▸ cache miss")} ${chalk.cyan(key)} ${chalk.dim(`${formatAge(existing.fetchedAt)} old, expired`)}`,
    );
  }

  const data = await fetch();

  const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
  // Set with TTL in seconds (rounded up)
  await redis.set(redisKey, entry, { ex: Math.ceil(ttlMs / 1000) });

  return data;
}
