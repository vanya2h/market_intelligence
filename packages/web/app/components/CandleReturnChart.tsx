import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { OhlcvCandle } from "@market-intel/api";
import type { TradeIdeaLevel } from "@market-intel/api";

function formatHours(h: number): string {
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function buildReturnPoints(
  candles: OhlcvCandle[],
  entryPrice: number,
  direction: string,
  createdAt: Date,
) {
  const sign = direction === "SHORT" ? -1 : 1;
  const entryTime = createdAt.getTime();
  return candles.map((c) => ({
    hoursAfter: Math.round(((c.time + 900_000 - entryTime) / 3_600_000) * 10) / 10,
    returnPct: sign * ((c.close - entryPrice) / entryPrice) * 100,
  }));
}

export function CandleReturnChart({
  candles,
  levels,
  entryPrice,
  direction,
  createdAt,
}: {
  candles: OhlcvCandle[];
  levels: TradeIdeaLevel[];
  entryPrice: number;
  direction: string;
  createdAt: Date;
}) {
  const data = buildReturnPoints(candles, entryPrice, direction, createdAt);

  if (data.length < 2) {
    return (
      <div
        className="flex h-48 items-center justify-center text-[0.625rem] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Awaiting price data
      </div>
    );
  }

  const lastReturn = data[data.length - 1]!;
  const isPositive = lastReturn.returnPct >= 0;
  const color = isPositive ? "var(--green)" : "var(--red)";

  const resolvedLevels = levels.filter((l) => l.outcome !== "OPEN");

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="hoursAfter"
            tickFormatter={formatHours}
            tick={{ fontSize: "0.5625rem", fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            tick={{ fontSize: "0.5625rem", fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: "0.6875rem",
              fontFamily: "JetBrains Mono, monospace",
              padding: "0.375rem 0.625rem",
            }}
            labelStyle={{ color: "var(--text-muted)", fontSize: "0.625rem" }}
            itemStyle={{ color: "var(--text-primary)" }}
            formatter={(v: number) => [`${v.toFixed(2)}%`, "Return"]}
            labelFormatter={(h: number) => formatHours(h)}
          />
          <Line
            type="monotone"
            dataKey="returnPct"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {resolvedLevels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {resolvedLevels.map((l) => (
            <span
              key={`${l.type}-${l.label}`}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.5625rem] font-medium font-mono-jb"
              style={{
                background: l.outcome === "WIN" ? "var(--green-dim)" : "var(--red-dim)",
                color: l.outcome === "WIN" ? "var(--green)" : "var(--red)",
              }}
            >
              {l.outcome === "WIN" ? "\u2713" : "\u2717"} {l.label}
              {l.qualityScore != null && (
                <span style={{ opacity: 0.7 }}>
                  {l.qualityScore > 0 ? "+" : ""}
                  {l.qualityScore.toFixed(1)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
