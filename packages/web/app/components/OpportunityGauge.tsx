import type { Confluence, TradeIdea } from "@market-intel/api";
import { CONFLUENCE_DIMENSIONS, DimensionEnum } from "@market-intel/pipeline/shared";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { DIMENSION_LABELS } from "../lib/dimensions";
import { Tooltip } from "./Tooltip";

/** Trend strength threshold for "strong" color on the Total row (0.5 = 50/100). */
const CONVICTION_THRESHOLD = 0.5;

/** Format a -1..+1 score as a signed integer percentage. */
function pctLabel(score: number): string {
  const v = Math.round(score * 100);
  return v >= 0 ? `+${v}` : `${v}`;
}

/**
 * Bipolar score color: green for buy, red for sell, muted near zero.
 */
function gaugeColor(score: number): string {
  const abs = Math.abs(score);
  if (abs < 10) return "var(--text-muted)";
  if (abs < 30) return "var(--text-secondary)";
  if (score > 0) return abs >= 60 ? "var(--green)" : "var(--amber)";
  return abs >= 60 ? "var(--red)" : "var(--amber)";
}

function gaugeLabel(score: number): string {
  const abs = Math.abs(score);
  const dir = score > 0 ? "Uptrend" : score < 0 ? "Downtrend" : "";
  if (abs >= 70) return `Strong ${dir}`;
  if (abs >= 40) return `${dir}`;
  if (abs >= 15) return `Weak ${dir}`;
  return "Ranging";
}

export function OpportunityGauge({ tradeIdea }: { tradeIdea: TradeIdea }) {
  const conf = tradeIdea.confluence;
  if (!conf) return null;

  // Bipolar score: -100 (strong sell) to +100 (strong buy).
  // confluenceTotal is already signed -1..+1 (positive = bullish).
  const score = Math.round((tradeIdea.confluenceTotal ?? 0) * 100);

  const color = gaugeColor(score);
  const prefix = score > 0 ? "+" : "";
  const taken = !tradeIdea.skipped;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Score */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono-jb text-4xl font-bold tabular-nums" style={{ color }}>
          {prefix}
          {Math.round(score)}
        </span>
      </div>

      {/* Verbal label */}
      <div className="text-xs font-medium uppercase tracking-wider" style={{ color }}>
        {gaugeLabel(score)}
      </div>

      {/* Bipolar bar: center = 0, left = sell, right = buy */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
        {/* Center line */}
        <div className="absolute top-0 bottom-0 w-px" style={{ left: "50%", background: "var(--border)" }} />
        {/* Fill bar */}
        {score !== 0 && (
          <div
            className="absolute top-0 h-full rounded-full transition-all"
            style={{
              background: color,
              ...(score > 0
                ? { left: "50%", width: `${(score / 100) * 50}%` }
                : { right: "50%", width: `${(-score / 100) * 50}%` }),
            }}
          />
        )}
      </div>

      {/* Scale labels */}
      <div className="flex justify-between">
        {[-100, -50, 0, 50, 100].map((tick) => (
          <span
            key={tick}
            className="font-mono-jb text-[0.5625rem] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {tick > 0 ? `+${tick}` : tick}
          </span>
        ))}
      </div>

      {/* Status line */}
      <div className="text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
        {taken ? (
          <span>
            Riding{" "}
            <span style={{ color }} className="font-medium">
              {tradeIdea.direction}
            </span>{" "}
            trend — sized to strength
          </span>
        ) : score !== 0 ? (
          <span>
            <span style={{ color }} className="font-medium">
              {score > 0 ? "Bullish" : "Bearish"}
            </span>{" "}
            momentum — strength {Math.abs(score)}/100
          </span>
        ) : (
          <span>No trend detected — market ranging</span>
        )}
      </div>
    </div>
  );
}

function dimScoreColor(score: number): string {
  if (score >= 0.2) return "var(--green)";
  if (score <= -0.2) return "var(--red)";
  return "var(--text-muted)";
}

const CONFLUENCE_TOOLTIPS: Record<DimensionEnum, string> = {
  [DimensionEnum.HTF]:
    "HTF structure: trend regime (bull/bear extended), CVD momentum, RSI momentum, volume profile position, and MA alignment.",
  [DimensionEnum.DERIVATIVES]:
    "Derivatives positioning: trend-confirming OI participation, funding direction, and stress/capitulation events.",
  [DimensionEnum.ETFS]:
    "ETF institutional flows: sustained inflow/outflow regime, streak momentum, and flow trend direction.",
  [DimensionEnum.EXCHANGE_FLOWS]:
    "Exchange flows: accumulation vs distribution regime and 7d/30d reserve trend direction.",
};

/** Per-dimension confluence breakdown — rows matching the Overview section style */
export function ConfluenceRows({ confluence, total }: { confluence: Confluence; total: number }) {
  return (
    <div className="space-y-1">
      {CONFLUENCE_DIMENSIONS.map((dim) => {
        const score = confluence[dim] ?? 0;
        const label = DIMENSION_LABELS[dim];
        const tooltip = CONFLUENCE_TOOLTIPS[dim];
        const color = dimScoreColor(score);

        return (
          <div
            key={dim}
            className="flex items-center justify-between py-1.5"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <Tooltip content={tooltip} side="right">
              <span
                className="inline-flex cursor-default items-center gap-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
                <InfoCircledIcon />
              </span>
            </Tooltip>
            <span className="font-mono-jb text-xs font-medium tabular-nums" style={{ color }}>
              {pctLabel(score)}
            </span>
          </div>
        );
      })}
      {/* Total — read from the persisted (normalized) total field */}
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Total
        </span>
        <span
          className="font-mono-jb text-xs font-bold tabular-nums"
          style={{
            color: total >= CONVICTION_THRESHOLD ? "var(--green)" : total > 0 ? "var(--amber)" : "var(--red)",
          }}
        >
          {pctLabel(total)} / 100
        </span>
      </div>
    </div>
  );
}
