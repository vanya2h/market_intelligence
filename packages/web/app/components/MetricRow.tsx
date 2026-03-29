import type { MetricSignal } from "../lib/dimension-config";
import { Tooltip } from "./Tooltip";

const SIGNAL_COLORS: Record<MetricSignal, string> = {
  bullish: "var(--green)",
  bearish: "var(--red)",
  neutral: "var(--amber)",
};

export function MetricRow({ label, value, signal, hint }: { label: string; value: string; signal?: MetricSignal; hint?: string }) {
  const valueColor = signal ? SIGNAL_COLORS[signal] : "var(--text-secondary)";
  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="flex items-center gap-1 font-mono-jb text-xs font-medium tabular-nums" style={{ color: valueColor }}>
        {value}
        {hint && (
          <Tooltip content={hint} side="left">
            <span
              className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[0.5625rem] leading-none"
              style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
            >
              ?
            </span>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
