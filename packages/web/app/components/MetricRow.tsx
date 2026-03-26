import type { MetricSignal } from "../lib/dimension-config";

const SIGNAL_COLORS: Record<MetricSignal, string> = {
  bullish: "var(--green)",
  bearish: "var(--red)",
  neutral: "var(--amber)",
};

export function MetricRow({ label, value, signal }: { label: string; value: string; signal?: MetricSignal }) {
  const valueColor = signal ? SIGNAL_COLORS[signal] : "var(--text-secondary)";
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="font-mono-jb text-xs font-medium tabular-nums" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  );
}
