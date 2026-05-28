import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "../lib/trade-idea";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

const chartConfig = {
  value: { label: "Trend Strength" },
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TrendStrengthChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-24 items-center justify-center text-[0.625rem] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Insufficient history
      </div>
    );
  }

  const chartData = data.map((p) => ({ ...p, displayTime: formatDate(p.time) }));

  return (
    <ChartContainer config={chartConfig} style={{ height: "110px" }}>
      <LineChart data={chartData} margin={{ top: 4, right: 2, left: -28, bottom: 0 }}>
        <defs>
          {/* Vertical gradient: green at top (+1), amber at mid (0), red at bottom (-1).
              Fixed domain means 0 always sits at 50% of chart height. */}
          <linearGradient id="trendLine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" />
            <stop offset="50%" stopColor="var(--amber)" />
            <stop offset="100%" stopColor="var(--red)" />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" strokeOpacity={0.4} />

        <XAxis dataKey="displayTime" hide />

        <YAxis
          domain={[-1, 1]}
          tickCount={3}
          tickFormatter={(v: number) => {
            const p = Math.round(v * 100);
            return p >= 0 ? `+${p}` : `${p}`;
          }}
          tick={{ fill: "var(--text-muted)", fontSize: 8 }}
          axisLine={false}
          tickLine={false}
        />

        <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />

        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(payload) => {
                const item = payload[0] as { payload?: { displayTime?: string } } | undefined;
                return item?.payload?.displayTime ?? "";
              }}
              formatter={(v) => {
                const n = typeof v === "number" ? v : parseFloat(String(v));
                const p = Math.round(n * 100);
                return (
                  <span style={{ color: p >= 0 ? "var(--green)" : "var(--red)" }}>{p >= 0 ? `+${p}` : `${p}`}</span>
                );
              }}
            />
          }
        />

        <Line
          dataKey="value"
          type="monotone"
          stroke="url(#trendLine)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
