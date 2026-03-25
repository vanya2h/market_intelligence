import { SentimentGauge } from "./SentimentGauge";

interface ComponentScores {
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
}

function ComponentBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const color =
    value < 30 ? "bg-red-500" : value > 70 ? "bg-emerald-500" : "bg-amber-500";

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-zinc-500">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-xs text-zinc-400">
        {Math.round(value)}
      </span>
    </div>
  );
}

function renderBriefText(text: string) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <br key={i} />;

    const rendered = line.replace(
      /\*\*(.+?)\*\*/g,
      '<strong class="text-zinc-100">$1</strong>'
    );

    const isBullet = line.trimStart().startsWith("- ");

    if (isBullet) {
      return (
        <li
          key={i}
          className="ml-4 list-disc text-sm leading-relaxed text-zinc-300"
          dangerouslySetInnerHTML={{ __html: rendered.replace(/^-\s*/, "") }}
        />
      );
    }

    return (
      <p
        key={i}
        className="text-sm leading-relaxed text-zinc-300"
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
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-indigo-400">
            Market Brief
          </h2>
          <p className="text-xs text-zinc-500">
            {asset} &middot;{" "}
            {new Date(timestamp).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        {compositeIndex != null && compositeLabel && (
          <div className="w-48">
            <SentimentGauge value={compositeIndex} label={compositeLabel} />
          </div>
        )}
      </div>

      <div className="mb-4 space-y-1">{renderBriefText(brief)}</div>

      {(components.positioning != null ||
        components.trend != null ||
        components.institutionalFlows != null ||
        components.expertConsensus != null) && (
        <div className="space-y-2 rounded-lg bg-zinc-900/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">
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
