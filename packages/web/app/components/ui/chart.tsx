"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

// ─── Context ──────────────────────────────────────────────────────────────────

type ChartContextProps = { config: ChartConfig };
const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart(): ChartContextProps {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error("useChart must be used within <ChartContainer />");
  return ctx;
}

// ─── Container ────────────────────────────────────────────────────────────────

export function ChartContainer({
  className,
  children,
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={`flex justify-center text-[0.5625rem] ${className ?? ""}`}
        style={style}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface ChartTooltipPayloadItem {
  value?: number | string;
  payload?: Record<string, unknown>;
}

export function ChartTooltipContent({
  active,
  payload,
  labelFormatter,
  formatter,
}: {
  active?: boolean;
  payload?: ChartTooltipPayloadItem[];
  labelFormatter?: (payload: ChartTooltipPayloadItem[]) => React.ReactNode;
  formatter?: (value: number | string) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  const value = first?.value;

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "0.25rem 0.5rem",
        fontSize: "0.5625rem",
        fontFamily: "JetBrains Mono, monospace",
        color: "var(--text-primary)",
      }}
    >
      {labelFormatter && (
        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{labelFormatter(payload)}</div>
      )}
      {value != null && (
        <span style={{ fontWeight: 600 }}>
          {formatter ? formatter(value) : String(value)}
        </span>
      )}
    </div>
  );
}
