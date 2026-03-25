import { ResponsiveContainer, AreaChart, Area, Tooltip, YAxis } from "recharts";

interface DataPoint {
  timestamp: string;
  value: number;
}

export function MiniChart({
  data,
  label,
  color = "var(--green)",
}: {
  data: DataPoint[];
  label: string;
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-20 items-center justify-center text-[10px] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Insufficient data
      </div>
    );
  }

  return (
    <div className="mt-2">
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Tooltip
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "6px 10px",
            }}
            labelStyle={{ color: "var(--text-muted)", fontSize: 10 }}
            itemStyle={{ color: "var(--text-primary)" }}
            formatter={(v: number) => [v.toFixed(4), label]}
            labelFormatter={(l: string) =>
              new Date(l).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${label})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
