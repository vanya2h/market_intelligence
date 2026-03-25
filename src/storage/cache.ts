/**
 * File-based API response cache.
 *
 * Each cached entry is stored as data/cache/<key>.json:
 *   { fetchedAt: ISO string, data: <raw API response> }
 *
 * Usage:
 *   const data = await getCached("my-endpoint", 4 * 60 * 60 * 1000, () => apiFetch());
 */

import fs from "node:fs";
import path from "node:path";

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

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
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
        `      [cache hit]  ${key} — ${formatAge(age)} old (TTL ${formatAge(ttlMs)})`
      );
      return entry.data;
    }
    console.log(
      `      [cache miss] ${key} — ${formatAge(age)} old, expired (TTL ${formatAge(ttlMs)})`
    );
  }

  const data = await fetch();
  const entry: CacheEntry<T> = { fetchedAt: new Date().toISOString(), data };
  fs.writeFileSync(file, JSON.stringify(entry));
  return data;
}
