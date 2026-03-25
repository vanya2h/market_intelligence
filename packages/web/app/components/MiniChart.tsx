import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";

interface DataPoint {
  timestamp: string;
  value: number;
}

export function MiniChart({
  data,
  label,
  color = "#6366f1",
}: {
  data: DataPoint[];
  label: string;
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-zinc-600">
        Not enough data for chart
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <ResponsiveContainer width="100%" height={96}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{
              background: "#18181b",
              border: "1px solid #27272a",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#a1a1aa" }}
            itemStyle={{ color: "#e4e4e7" }}
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
