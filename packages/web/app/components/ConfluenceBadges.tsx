import type { Confluence } from "@market-intel/api";
import { CONFLUENCE_KEY_MAP, CONFLUENCE_KEYS, DIMENSION_LABELS, DIMENSION_SHORT_LABELS } from "../lib/dimensions";

/**
 * All confluence values now live in -1..+1 (per-dim are unweighted normalized
 * scores; total is the weighted average). The UI renders them as percentages.
 * The API normalizes legacy rows on read, so we trust `confluence.total` here.
 * We still fall back to summing per-dim if `total` is missing (very old rows).
 */
function readTotal(conf: Confluence): number {
  if (typeof conf.total === "number") return conf.total;
  return CONFLUENCE_KEYS.reduce((sum, key) => sum + (conf[key] ?? 0), 0);
}

/** Format a -1..+1 score as a signed integer percentage. */
function pctLabel(score: number): string {
  const v = Math.round(score * 100);
  return v >= 0 ? `+${v}` : `${v}`;
}

const LABELS: Record<string, string> = Object.fromEntries(
  CONFLUENCE_KEYS.map((k) => {
    const dim = Object.entries(CONFLUENCE_KEY_MAP).find(([, v]) => v === k)?.[0] as string;
    return [k, DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS]];
  }),
);

function scoreColor(score: number): string {
  if (score >= 0.2) return "var(--green)";
  if (score <= -0.2) return "var(--red)";
  return "var(--text-muted)";
}

function totalColor(total: number): string {
  if (total >= 0.6) return "var(--green)";
  if (total >= 0.25) return "var(--amber)";
  if (total <= -0.25) return "var(--red)";
  return "var(--text-muted)";
}

/** Inline badges — compact row of dimension scores + total */
export function ConfluenceBadges({ confluence }: { confluence: Confluence }) {
  const total = readTotal(confluence);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {CONFLUENCE_KEYS.map((dim) => {
        const score = confluence[dim] ?? 0;
        return (
          <span
            key={dim}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.625rem] font-medium"
            style={{
              color: scoreColor(score),
              background: score >= 0.2 ? "var(--green-dim)" : score <= -0.2 ? "var(--red-dim)" : "var(--bg-hover)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {DIMENSION_SHORT_LABELS[dim]}
            <span className="font-mono-jb tabular-nums">{pctLabel(score)}</span>
          </span>
        );
      })}
      <span className="text-[0.625rem] font-bold font-mono-jb tabular-nums" style={{ color: totalColor(total) }}>
        {"\u03A3"}
        {pctLabel(total)}/100
      </span>
    </div>
  );
}

/** Full breakdown — visual bars with dimension scores and conviction meter */
export function ConfluenceBreakdown({ confluence }: { confluence: Confluence }) {
  const total = readTotal(confluence);
  // Conviction meter fills 0..100% based on |total| (signed by color), so a
  // total of +1 fills the bar; -1 also fills it but in red.
  const convictionPct = Math.max(0, Math.min(100, Math.abs(total) * 100));

  return (
    <div className="flex flex-col gap-2">
      {/* Per-dimension bars */}
      {CONFLUENCE_KEYS.map((dim) => {
        const score = confluence[dim] ?? 0;
        const absPct = Math.min(1, Math.abs(score));
        const isPositive = score >= 0;

        return (
          <div key={dim} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[0.5625rem] font-medium" style={{ color: "var(--text-muted)" }}>
              {LABELS[dim]}
            </span>

            {/* Bar container */}
            <div className="relative flex-1 h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-hover)" }}>
              {/* Center line */}
              <div className="absolute top-0 bottom-0 w-px" style={{ left: "50%", background: "var(--border)" }} />

              {/* Score bar */}
              <div
                className="absolute top-0.5 bottom-0.5 rounded-sm transition-all"
                style={{
                  background: isPositive ? "var(--green)" : "var(--red)",
                  opacity: 0.7,
                  ...(isPositive
                    ? { left: "50%", width: `${absPct * 50}%` }
                    : { right: "50%", width: `${absPct * 50}%` }),
                }}
              />
            </div>

            {/* Score value */}
            <span
              className="w-10 shrink-0 text-right font-mono-jb tabular-nums text-[0.625rem] font-bold"
              style={{ color: scoreColor(score) }}
            >
              {pctLabel(score)}
            </span>
          </div>
        );
      })}

      {/* Conviction meter — fill to 400, color by strength */}
      <div className="mt-1 flex items-center gap-2">
        <span
          className="w-20 shrink-0 text-[0.5625rem] font-bold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Conviction
        </span>

        <div className="relative flex-1 h-5 rounded-sm overflow-hidden" style={{ background: "var(--bg-hover)" }}>
          {/* Fill bar */}
          <div
            className="absolute top-0.5 bottom-0.5 left-0 rounded-sm transition-all"
            style={{
              width: `${convictionPct}%`,
              background:
                total >= 0.6
                  ? "var(--green)"
                  : total >= 0.25
                    ? "var(--amber)"
                    : total > 0
                      ? "var(--text-muted)"
                      : "var(--red)",
              opacity: 0.6,
            }}
          />
        </div>

        <span
          className="w-16 shrink-0 text-right font-mono-jb tabular-nums text-[0.625rem] font-bold"
          style={{ color: totalColor(total) }}
        >
          {pctLabel(total)}/100
        </span>
      </div>
    </div>
  );
}
