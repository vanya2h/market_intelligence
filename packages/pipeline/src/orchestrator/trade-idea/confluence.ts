/**
 * Parse a raw DB JSON blob (JsonValue from Prisma) into the stored total.
 * Handles both legacy formats (per-dim keys, old camelCase) and current format.
 */
export function parseStoredConfluence(json: unknown): { total: number | null } {
  const raw = (json != null && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return {
    total: typeof raw.total === "number" ? raw.total : null,
  };
}
