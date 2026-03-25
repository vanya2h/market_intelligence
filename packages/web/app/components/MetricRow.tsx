export function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="text-xs font-medium tabular-nums"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-secondary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
