import type { TradeIdea } from "@market-intel/api";
import { Tooltip } from "./Tooltip";

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
  if (abs < 15) return "No edge";
  const dir = score > 0 ? "Bullish" : "Bearish";
  if (abs >= 70) return `Strong ${dir}`;
  if (abs >= 40) return dir;
  return `Weak ${dir}`;
}

function modelBadge(aggregator: TradeIdea["aggregator"]): { label: string; title: string } {
  if (aggregator?.source === "ml" && aggregator.modelVersion?.startsWith("snapshot_")) {
    return { label: "Snapshot ML · 7d", title: "Score from the snapshot regression model trained on 168h forward returns" };
  }
  if (aggregator?.source === "ml") {
    return { label: `ML · ${aggregator.modelVersion ?? ""}`, title: "Score from an ONNX ML aggregator model" };
  }
  return { label: "Heuristic", title: "Equal-weight average of per-dimension heuristic scores — no ML model loaded" };
}

export function OpportunityGauge({ tradeIdea }: { tradeIdea: TradeIdea }) {
  const score = Math.round((tradeIdea.confluenceTotal ?? 0) * 100);
  const color = gaugeColor(score);
  const prefix = score > 0 ? "+" : "";
  const taken = !tradeIdea.skipped;
  const badge = modelBadge(tradeIdea.aggregator);
  const displayDirection = score >= 0 ? "LONG" : "SHORT";

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Score + model badge */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono-jb text-4xl font-bold tabular-nums" style={{ color }}>
          {prefix}
          {Math.round(score)}
        </span>
        <Tooltip content={badge.title} side="left">
          <span
            className="cursor-default rounded px-1.5 py-0.5 text-[0.5rem] font-medium uppercase tracking-wider"
            style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
          >
            {badge.label}
          </span>
        </Tooltip>
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

      {/* Model stats */}
      {tradeIdea.aggregator?.stats && (
        <div
          className="flex items-center gap-3 rounded px-2 py-1.5 text-[0.5625rem] tabular-nums"
          style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
        >
          <Tooltip
            content="Out-of-fold Information Coefficient — Pearson correlation between the model's predictions and actual 7-day returns on data it never trained on. Ranges -1 to +1; above +0.05 is considered meaningful."
            side="bottom"
          >
            <span className="cursor-default">
              OOF IC{" "}
              <span className="font-mono-jb font-medium" style={{ color: "var(--text-secondary)" }}>
                {tradeIdea.aggregator.stats.oofIc >= 0 ? "+" : ""}
                {tradeIdea.aggregator.stats.oofIc.toFixed(2)}
              </span>
            </span>
          </Tooltip>
          <span style={{ color: "var(--border)" }}>·</span>
          <Tooltip
            content="Directional accuracy on held-out data — how often the model correctly predicted whether price would be higher or lower after 7 days. 50% = coin flip."
            side="bottom"
          >
            <span className="cursor-default">
              Hit rate{" "}
              <span className="font-mono-jb font-medium" style={{ color: "var(--text-secondary)" }}>
                {Math.round(tradeIdea.aggregator.stats.hitRate * 100)}%
              </span>
            </span>
          </Tooltip>
          <span style={{ color: "var(--border)" }}>·</span>
          <Tooltip
            content="Number of historical snapshots used to train this model. More samples = more reliable statistics, especially across different market regimes."
            side="bottom"
          >
            <span className="cursor-default">n={tradeIdea.aggregator.stats.nSamples}</span>
          </Tooltip>
        </div>
      )}

      {/* Status line */}
      <div className="text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
        {Math.abs(score) < 15 ? (
          <span>No directional edge predicted for next 7 days</span>
        ) : (
          <span>
            Predicting{" "}
            <span style={{ color }} className="font-medium">
              {displayDirection}
            </span>{" "}
            over 7 days
            {taken ? " — position sized to conviction" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

