import type { Confluence, TradeIdea } from "@market-intel/api";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { CONFLUENCE_KEY_MAP, CONFLUENCE_KEYS, type ConfluenceKey, DIMENSION_LABELS } from "../lib/dimensions";
import { Tooltip } from "./Tooltip";

/**
 * Conviction "fully loaded" threshold on the new -1..+1 scale (= 0.5 of full).
 * Used purely for color/label switching in the UI; the trade decision itself
 * is mechanical and unconditional.
 */
const CONVICTION_THRESHOLD = 0.5;

/**
 * Read the persisted total directly. Confluence values are now in -1..+1
 * (per-dim are unweighted, total is the weighted average) and the API
 * normalizes legacy rows on read. Falls back to a per-dim sum only when the
 * total field is missing for some legacy reason.
 */
function readTotal(conf: Confluence): number {
  if (typeof conf.total === "number") return conf.total;
  return CONFLUENCE_KEYS.reduce((sum, key) => sum + (conf[key] ?? 0), 0);
}

/** Format a -1..+1 score as a signed integer percentage. */
function pctLabel(score: number): string {
  const v = Math.round(score * 100);
  return v >= 0 ? `+${v}` : `${v}`;
}

const CONFLUENCE_TOOLTIPS: Record<ConfluenceKey, string> = {
  htf: "HTF structure: volatility compression, CVD divergence, RSI stretch, volume profile displacement, and MA mean-reversion pull.",
  derivatives:
    "Derivatives positioning: crowded longs/shorts, stress events (capitulation/unwinding), funding extremes, and open interest fuel.",
  etfs: "ETF institutional flows: flow sigma with regime contradiction, reversal confirmation after streaks, reversal ratio, and reversal regime.",
  exchangeFlows: "Exchange flows: 7d/30d reserve changes (accumulation vs distribution) and 30-day reserve extremes.",
};

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
  const dir = score > 0 ? "Buy" : score < 0 ? "Sell" : "";
  if (abs >= 70) return `Strong ${dir}`;
  if (abs >= 40) return `Moderate ${dir}`;
  if (abs >= 15) return `Weak ${dir}`;
  return "No Edge";
}

export function OpportunityGauge({ tradeIdea }: { tradeIdea: TradeIdea }) {
  const conf = tradeIdea.confluence;
  if (!conf) return null;

  const bias = conf.bias;

  // Bipolar score: -100 (strong sell) to +100 (strong buy).
  // bias.strength is now stored as 0..1; multiply by 100 here so the gauge's
  // visual scale (which renders -100..+100) doesn't need to change.
  const strengthPct = (bias?.strength ?? 0) * 100;
  const score = bias?.lean === "LONG" ? strengthPct : bias?.lean === "SHORT" ? -strengthPct : 0;

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
            Trade{" "}
            <span style={{ color }} className="font-medium">
              {tradeIdea.direction}
            </span>{" "}
            taken — sized to conviction
          </span>
        ) : bias && bias.lean !== "NEUTRAL" ? (
          <span>
            Bias{" "}
            <span style={{ color }} className="font-medium">
              {bias.lean}
            </span>{" "}
            — strength {Math.round(bias.strength * 100)}/100
          </span>
        ) : (
          <span>No directional edge detected</span>
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

/** Per-dimension confluence breakdown — rows matching the Overview section style */
export function ConfluenceRows({ confluence }: { confluence: Confluence }) {
  return (
    <div className="space-y-1">
      {CONFLUENCE_KEYS.map((key) => {
        const score = confluence[key] ?? 0;
        const dim = Object.entries(CONFLUENCE_KEY_MAP).find(([, v]) => v === key)?.[0] as string;
        const label = DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS];
        const tooltip = CONFLUENCE_TOOLTIPS[key];
        const color = dimScoreColor(score);

        return (
          <div
            key={key}
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
      {/* Total — read directly from the persisted (normalized) total field */}
      {(() => {
        const total = readTotal(confluence);
        return (
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
        );
      })()}
    </div>
  );
}
