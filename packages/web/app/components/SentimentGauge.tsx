export function SentimentGauge({ value, label }: { value: number; label: string }) {
  const getColor = (v: number) => {
    if (v <= 25) return { color: "var(--red)", bg: "var(--red-dim)", text: "Extreme Fear" };
    if (v <= 40) return { color: "var(--red)", bg: "var(--red-dim)", text: "Fear" };
    if (v <= 60) return { color: "var(--amber)", bg: "var(--amber-dim)", text: "Neutral" };
    if (v <= 75) return { color: "var(--green)", bg: "var(--green-dim)", text: "Greed" };
    return { color: "var(--green)", bg: "var(--green-dim)", text: "Extreme Greed" };
  };

  const { color, bg } = getColor(value);

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-baseline gap-2">
        <span className="font-mono-jb text-4xl font-bold tabular-nums" style={{ color }}>
          {Math.round(value)}
        </span>
        <span className="text-xs tracking-wide" style={{ color: "var(--text-muted)" }}>
          /100
        </span>
      </div>
      <div className="text-xs font-medium uppercase tracking-wider" style={{ color }}>
        {label}
      </div>
      <div className="relative h-1.5 w-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
        <div className="bar-fill absolute left-0 top-0 h-full" style={{ width: `${value}%`, background: color }} />
      </div>
      {/* Tick marks */}
      <div className="flex justify-between">
        {[0, 25, 50, 75, 100].map((tick) => (
          <span
            key={tick}
            className="font-mono-jb text-[0.5625rem] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}
