import type { Confluence } from "@market-intel/api";

const LABELS: Record<keyof Confluence, string> = {
  derivatives: "Deriv",
  etfs: "ETFs",
  htf: "HTF",
  sentiment: "Sent",
};

function scoreColor(score: number): string {
  if (score === 1) return "var(--green)";
  if (score === -1) return "var(--red)";
  return "var(--text-muted)";
}

function scoreBg(score: number): string {
  if (score === 1) return "var(--green-dim)";
  if (score === -1) return "var(--red-dim)";
  return "var(--bg-hover)";
}

function scoreLabel(score: number): string {
  if (score === 1) return "+1";
  if (score === -1) return "-1";
  return "0";
}

export function ConfluenceBadges({ confluence }: { confluence: Confluence }) {
  const entries = Object.entries(confluence) as [keyof Confluence, number][];
  const aligned = entries.filter(([, s]) => s === 1).length;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {entries.map(([dim, score]) => (
        <span
          key={dim}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium"
          style={{
            color: scoreColor(score),
            background: scoreBg(score),
            border: "1px solid var(--border-subtle)",
          }}
        >
          {LABELS[dim]}
          <span className="font-mono-jb tabular-nums">{scoreLabel(score)}</span>
        </span>
      ))}
      <span
        className="text-[10px] font-medium font-mono-jb tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {aligned}/4
      </span>
    </div>
  );
}
