import { RelativeTime } from "./RelativeTime";

interface ComponentScores {
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
}

function ComponentBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;

  const getColor = (v: number) => {
    if (v < 30) return "var(--red)";
    if (v > 70) return "var(--green)";
    return "var(--amber)";
  };

  const color = getColor(value);

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-[0.6875rem]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <div className="h-1 flex-1" style={{ background: "var(--bg-hover)" }}>
        <div className="bar-fill h-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="font-mono-jb w-6 text-right text-[0.6875rem] tabular-nums" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

function renderBriefText(text: string) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <br key={i} />;

    const rendered = line.replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--text-primary)">$1</strong>');

    const isBullet = line.trimStart().startsWith("- ");

    if (isBullet) {
      return (
        <li
          key={i}
          className="ml-3 text-[0.8125rem] leading-relaxed"
          style={{ color: "var(--text-secondary)", listStyleType: "none" }}
          dangerouslySetInnerHTML={{
            __html: `<span style="color: var(--text-muted); margin-right: 0.375rem">&#8250;</span>${rendered.replace(/^-\s*/, "")}`,
          }}
        />
      );
    }

    return (
      <p
        key={i}
        className="text-[0.8125rem] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  });
}

export function BriefCard({
  brief,
  compositeIndex,
  compositeLabel,
  components,
  timestamp,
  asset,
}: {
  brief: string;
  compositeIndex: number | null;
  compositeLabel: string | null;
  components: ComponentScores;
  timestamp: string;
  asset: string;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[0.625rem] font-medium uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Market Brief
        </span>
        <span className="text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
          {asset} &middot; Generated <RelativeTime date={new Date(timestamp)} />
        </span>
      </div>

      <div className="space-y-1.5">{renderBriefText(brief)}</div>

      {(components.positioning != null ||
        components.trend != null ||
        components.institutionalFlows != null ||
        components.expertConsensus != null) && (
        <div
          className="mt-5 space-y-2 p-3"
          style={{
            background: "var(--bg-surface)",
            borderLeft: "2px solid var(--border)",
          }}
        >
          <div
            className="text-[0.5625rem] font-medium uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Fear &amp; Greed Components
          </div>
          <ComponentBar label="Positioning" value={components.positioning} />
          <ComponentBar label="Trend" value={components.trend} />
          <ComponentBar label="Inst. Flows" value={components.institutionalFlows} />
          <ComponentBar label="Expert Cons." value={components.expertConsensus} />
        </div>
      )}
    </div>
  );
}
