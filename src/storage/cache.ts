/**
 * File-based API response cache.
 *
 * Each cached entry is stored as data/cache/<key>.json:
 *   { fetchedAt: ISO string, data: <raw API response> }
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { formatDistanceToNowStrict } from "date-fns";

const CACHE_DIR = path.resolve("data", "cache");

interface CacheEntry<T> {
  fetchedAt: string;
  data: T;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function formatAge(fetchedAt: string): string {
  return formatDistanceToNowStrict(new Date(fetchedAt), { addSuffix: true });
}

export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetch: () => Promise<T>
): Promise<T> {
  ensureCacheDir();
  const file = cacheFile(key);

  if (fs.existsSync(file)) {
    const entry = JSON.parse(fs.readFileSync(file, "utf-8")) as CacheEntry<T>;
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age < ttlMs) {
      console.log(
        `      ${chalk.green("▸ cache hit")}  ${chalk.cyan(key)} ${chalk.dim(`${formatAge(entry.fetchedAt)} old`)}`
      );
      return entry.data;
    }
    console.log(
      `      ${chalk.yellow("▸ cache miss")} ${chalk.cyan(key)} ${chalk.dim(`${formatAge(entry.fetchedAt)} old, expired`)}`
    );
  }

  const data = await fetch();
  const entry: CacheEntry<T> = { fetchedAt: new Date().toISOString(), data };
  fs.writeFileSync(file, JSON.stringify(entry));
  return data;
}
