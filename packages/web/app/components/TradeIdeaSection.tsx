import type { TradeIdea } from "@market-intel/api";
import { SectionBlock } from "./SectionBlock";
import { UsdValue } from "./UsdValue";
import { ConfluenceBadges } from "./ConfluenceBadges";
import { LevelStatus } from "./LevelStatus";
import { ReturnsCurve } from "./ReturnsCurve";

function directionStyle(direction: string): { color: string; bg: string; label: string } {
  if (direction === "LONG") return { color: "var(--green)", bg: "var(--green-dim)", label: "LONG \u25B2" };
  if (direction === "SHORT") return { color: "var(--red)", bg: "var(--red-dim)", label: "SHORT \u25BC" };
  return { color: "var(--text-muted)", bg: "var(--bg-hover)", label: "FLAT \u2014" };
}

export function TradeIdeaSection({ tradeIdea, compact }: { tradeIdea: TradeIdea; compact?: boolean }) {
  const dir = directionStyle(tradeIdea.direction);

  return (
    <SectionBlock
      title="Trade Idea"
      tooltip="Automatically extracted trade idea with composite mean-reversion target. Levels are tracked independently to find the optimal R:R and take-profit strategy."
    >
      {/* Header row: direction + entry + target */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <span
          className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold font-mono-jb"
          style={{ color: dir.color, background: dir.bg, border: `1px solid ${dir.color}33` }}
        >
          {dir.label}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Entry{" "}
          <UsdValue value={tradeIdea.entryPrice} style={{ color: "var(--text-primary)", fontSize: 11 }} />
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Target{" "}
          <UsdValue value={tradeIdea.compositeTarget} style={{ color: "var(--text-primary)", fontSize: 11 }} />
        </span>
      </div>

      {/* Confluence badges */}
      {tradeIdea.confluence && (
        <div className="mb-4">
          <ConfluenceBadges confluence={tradeIdea.confluence} />
        </div>
      )}

      {/* Main content: levels + chart */}
      <div className={compact ? "" : "grid gap-4 md:grid-cols-[220px_1fr]"}>
        <LevelStatus
          levels={tradeIdea.levels}
          entryPrice={tradeIdea.entryPrice}
          direction={tradeIdea.direction}
        />
        {!compact && (
          <div
            className="rounded-md p-3"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="mb-2 text-[9px] font-medium uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              Returns Curve
            </div>
            <ReturnsCurve returns={tradeIdea.returns} levels={tradeIdea.levels} />
          </div>
        )}
      </div>
    </SectionBlock>
  );
}
