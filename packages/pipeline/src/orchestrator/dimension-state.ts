/**
 * JSON-file backed state store for dimensions other than derivatives.
 * Each file in `data/` holds a `{ [asset]: state }` map keyed by asset symbol.
 *
 * Derivatives uses a Postgres-backed state store in storage/json.ts because
 * its history was the first to migrate; the other dimensions still live here
 * and can move to Postgres when the JSON-file pattern becomes a problem.
 */
import fs from "node:fs";
import path from "node:path";

export function loadJsonState<T>(file: string, key: string): T | null {
  const fullPath = path.resolve("data", file);
  if (!fs.existsSync(fullPath)) return null;
  const all = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as Record<string, T>;
  return all[key] ?? null;
}

export function saveJsonState<T>(file: string, key: string, state: T): void {
  const fullPath = path.resolve("data", file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const all: Record<string, T> = fs.existsSync(fullPath)
    ? (JSON.parse(fs.readFileSync(fullPath, "utf-8")) as Record<string, T>)
    : {};
  all[key] = state;
  fs.writeFileSync(fullPath, JSON.stringify(all, null, 2));
}
