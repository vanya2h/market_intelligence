import type { Confluence } from "@market-intel/api";

const DIMENSION_KEYS = ["derivatives", "etfs", "htf", "sentiment", "exchangeFlows"] as const;

const LABELS: Record<string, string> = {
  derivatives: "Derivatives",
  etfs: "ETF Flows",
  htf: "HTF Structure",
  sentiment: "Sentiment",
  exchangeFlows: "Exchange Flows",
};

const SHORT_LABELS: Record<string, string> = {
  derivatives: "Deriv",
  etfs: "ETFs",
  htf: "HTF",
  sentiment: "Sent",
  exchangeFlows: "ExFlow",
};

function scoreColor(score: number): string {
  if (score >= 50) return "var(--green)";
  if (score >= 20) return "var(--green)";
  if (score <= -50) return "var(--red)";
  if (score <= -20) return "var(--red)";
  return "var(--text-muted)";
}

function scoreLabel(score: number): string {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

function totalColor(total: number): string {
  if (total >= 200) return "var(--green)";
  if (total >= 150) return "var(--amber)";
  if (total <= -150) return "var(--red)";
  return "var(--text-muted)";
}

const CONVICTION_THRESHOLD = 200;

/** Inline badges — compact row of dimension scores + total / threshold */
export function ConfluenceBadges({ confluence }: { confluence: Confluence }) {
  const total = confluence.total ?? 0;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {DIMENSION_KEYS.map((dim) => {
        const score = confluence[dim] ?? 0;
        return (
          <span
            key={dim}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.625rem] font-medium"
            style={{
              color: scoreColor(score),
              background: score >= 20 ? "var(--green-dim)" : score <= -20 ? "var(--red-dim)" : "var(--bg-hover)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {SHORT_LABELS[dim]}
            <span className="font-mono-jb tabular-nums">{scoreLabel(score)}</span>
          </span>
        );
      })}
      <span
        className="text-[0.625rem] font-bold font-mono-jb tabular-nums"
        style={{ color: totalColor(total) }}
      >
        {"\u03A3"}{total}/{CONVICTION_THRESHOLD}
      </span>
    </div>
  );
}

/** Full breakdown — visual bars with dimension scores and conviction meter */
export function ConfluenceBreakdown({ confluence }: { confluence: Confluence }) {
  const maxScore = 100;
  const total = confluence.total ?? 0;
  const maxTotal = 500;
  const convictionPct = Math.max(0, Math.min(100, (total / maxTotal) * 100));
  const thresholdPct = (CONVICTION_THRESHOLD / maxTotal) * 100;
  const passesThreshold = total >= CONVICTION_THRESHOLD;

  return (
    <div className="flex flex-col gap-2">
      {/* Per-dimension bars */}
      {DIMENSION_KEYS.map((dim) => {
        const score = confluence[dim] ?? 0;
        const absPct = Math.abs(score) / maxScore;
        const isPositive = score >= 0;

        return (
          <div key={dim} className="flex items-center gap-2">
            <span
              className="w-20 shrink-0 text-[0.5625rem] font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {LABELS[dim]}
            </span>

            {/* Bar container */}
            <div
              className="relative flex-1 h-4 rounded-sm overflow-hidden"
              style={{ background: "var(--bg-hover)" }}
            >
              {/* Center line */}
              <div
                className="absolute top-0 bottom-0 w-px"
                style={{ left: "50%", background: "var(--border)" }}
              />

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
              {scoreLabel(score)}
            </span>
          </div>
        );
      })}

      {/* Conviction meter */}
      <div className="mt-1 flex items-center gap-2">
        <span
          className="w-20 shrink-0 text-[0.5625rem] font-bold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Conviction
        </span>

        <div
          className="relative flex-1 h-5 rounded-sm overflow-hidden"
          style={{ background: "var(--bg-hover)" }}
        >
          {/* Threshold marker */}
          <div
            className="absolute top-0 bottom-0 w-px z-10"
            style={{
              left: `${thresholdPct}%`,
              background: "var(--text-muted)",
              opacity: 0.5,
            }}
          />
          <span
            className="absolute text-[0.5rem] font-mono-jb z-10"
            style={{
              left: `${thresholdPct}%`,
              top: 0,
              transform: "translateX(-50%)",
              color: "var(--text-muted)",
              opacity: 0.7,
            }}
          >
            200
          </span>

          {/* Fill bar */}
          <div
            className="absolute top-0.5 bottom-0.5 left-0 rounded-sm transition-all"
            style={{
              width: `${convictionPct}%`,
              background: passesThreshold
                ? "var(--green)"
                : total > 0
                  ? "var(--amber)"
                  : "var(--red)",
              opacity: 0.6,
            }}
          />
        </div>

        <span
          className="w-16 shrink-0 text-right font-mono-jb tabular-nums text-[0.625rem] font-bold"
          style={{ color: totalColor(total) }}
        >
          {total}/{CONVICTION_THRESHOLD}
        </span>
      </div>
    </div>
  );
}
