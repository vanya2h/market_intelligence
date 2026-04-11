import type { TradeIdea } from "@market-intel/api";
import { SectionBlock } from "./SectionBlock";
import { UsdValue } from "./UsdValue";
import { InlineLink } from "./InlineLink";
import { ConfluenceBadges, ConfluenceBreakdown } from "./ConfluenceBadges";
import { LevelStatus } from "./LevelStatus";
import { ReturnsCurve } from "./ReturnsCurve";

function LearnLink() {
  return (
    <div className="mt-3 flex items-center gap-4">
      <InlineLink to="/faq#trade-ideas" className="inline-flex items-center gap-1 text-[0.725rem]">
        <span>{"\u2192"}</span> How Trade Ideas works
      </InlineLink>
      <InlineLink to="/signals" className="inline-flex items-center gap-1 text-[0.725rem]">
        <span>{"\u2192"}</span> Signal Effectiveness
      </InlineLink>
    </div>
  );
}

function directionStyle(direction: string): { color: string; bg: string; label: string } {
  if (direction === "LONG") return { color: "var(--green)", bg: "var(--green-dim)", label: "LONG \u25B2" };
  if (direction === "SHORT") return { color: "var(--red)", bg: "var(--red-dim)", label: "SHORT \u25BC" };
  return { color: "var(--text-muted)", bg: "var(--bg-hover)", label: "FLAT \u2014" };
}

function formatAge(createdAt: Date): string {
  const hours = Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

/** Color for position size badge: green = large, amber = medium, muted = small */
function sizeColor(pct: number): string {
  if (pct >= 80) return "var(--green)";
  if (pct >= 40) return "var(--amber)";
  return "var(--text-muted)";
}

export function TradeIdeaSection({ tradeIdea, compact }: { tradeIdea: TradeIdea; compact?: boolean }) {
  const dir = directionStyle(tradeIdea.direction);
  const age = formatAge(tradeIdea.createdAt);
  const totalLevels = tradeIdea.levels.length;
  const wins = tradeIdea.levels.filter((l) => l.outcome === "WIN").length;
  const losses = tradeIdea.levels.filter((l) => l.outcome === "LOSS").length;
  const resolved = wins + losses;
  const statusLabel = resolved === totalLevels ? "Resolved" : "Tracking";
  const statusColor = resolved === totalLevels ? "var(--text-muted)" : "var(--amber)";

  const targetDistPct = ((tradeIdea.compositeTarget - tradeIdea.entryPrice) / tradeIdea.entryPrice) * 100;
  const lastReturn = tradeIdea.returns.length > 0 ? tradeIdea.returns[tradeIdea.returns.length - 1] : null;

  const sizePct = tradeIdea.positionSizePct;
  const sizingInfo = (tradeIdea.confluence as { sizing?: { convictionMultiplier?: number } } | null)?.sizing;

  return (
    <SectionBlock
      title="Trade Idea"
      tooltip="Directional trade idea — always taken, sized proportionally to conviction × volatility. 4 dimensions (HTF, Derivatives, ETFs, Exchange Flows) each score -100 to +100. Levels tracked independently with time-decay quality scoring."
    >
      {/* Header: direction + prices + status */}
      <div
        className="rounded-md p-3 mb-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <span
            className="inline-flex items-center rounded px-2.5 py-1 text-xs font-bold font-mono-jb"
            style={{ color: dir.color, background: dir.bg, border: `1px solid ${dir.color}33` }}
          >
            {dir.label}
          </span>

          <span className="text-[0.625rem] font-mono-jb" style={{ color: "var(--text-muted)" }}>
            {age}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wider"
            style={{ color: statusColor, background: "var(--bg-hover)" }}
          >
            {statusLabel}
          </span>

          {/* Position size badge */}
          {sizePct > 0 && (
            <span
              className="rounded px-1.5 py-0.5 text-[0.5625rem] font-mono-jb font-medium"
              style={{
                color: sizeColor(sizePct),
                background: "var(--bg-hover)",
                border: `1px solid color-mix(in srgb, ${sizeColor(sizePct)} 25%, transparent)`,
              }}
              title={sizingInfo?.convictionMultiplier ? `${sizingInfo.convictionMultiplier}x conviction multiplier` : undefined}
            >
              {sizePct}% notional
            </span>
          )}

          <span className="grow" />

          {(wins > 0 || losses > 0) && (
            <span className="text-[0.625rem] font-mono-jb" style={{ color: "var(--text-muted)" }}>
              {wins > 0 && <span style={{ color: "var(--green)" }}>{wins}W</span>}
              {wins > 0 && losses > 0 && " "}
              {losses > 0 && <span style={{ color: "var(--red)" }}>{losses}L</span>}
              <span style={{ opacity: 0.5 }}> / {totalLevels}</span>
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-4 flex-wrap">
          <div className="flex flex-col">
            <span
              className="text-[0.5rem] font-medium uppercase tracking-wider mb-0.5"
              style={{ color: "var(--text-muted)" }}
            >
              Entry
            </span>
            <UsdValue
              value={tradeIdea.entryPrice}
              style={{ color: "var(--text-primary)", fontSize: "0.8125rem", fontWeight: 600 }}
            />
          </div>

          {tradeIdea.direction !== "FLAT" && (
            <>
              <div className="flex flex-col">
                <span
                  className="text-[0.5rem] font-medium uppercase tracking-wider mb-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  Target
                </span>
                <UsdValue
                  value={tradeIdea.compositeTarget}
                  style={{ color: dir.color, fontSize: "0.8125rem", fontWeight: 600 }}
                />
              </div>

              <div className="flex flex-col">
                <span
                  className="text-[0.5rem] font-medium uppercase tracking-wider mb-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  Distance
                </span>
                <span className="font-mono-jb tabular-nums text-[0.8125rem] font-semibold" style={{ color: dir.color }}>
                  {targetDistPct > 0 ? "+" : ""}
                  {targetDistPct.toFixed(2)}%
                </span>
              </div>
            </>
          )}

          {lastReturn && (
            <div className="flex flex-col ml-auto">
              <span
                className="text-[0.5rem] font-medium uppercase tracking-wider mb-0.5"
                style={{ color: "var(--text-muted)" }}
              >
                Current P&L
              </span>
              <span
                className="font-mono-jb tabular-nums text-[0.8125rem] font-semibold"
                style={{ color: lastReturn.returnPct >= 0 ? "var(--green)" : "var(--red)" }}
              >
                {lastReturn.returnPct >= 0 ? "+" : ""}
                {lastReturn.returnPct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Confluence */}
      {tradeIdea.confluence && (
        <div className="mb-4">
          {compact ? (
            <ConfluenceBadges confluence={tradeIdea.confluence} />
          ) : (
            <div
              className="rounded-md p-3"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
            >
              <div
                className="mb-2 text-[0.5625rem] font-medium uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                Confluence Scoring
              </div>
              <ConfluenceBreakdown confluence={tradeIdea.confluence} />
            </div>
          )}
        </div>
      )}

      {/* Levels + chart */}
      <div className={compact ? "" : "grid gap-4 md:grid-cols-[13.75rem_1fr]"}>
        <LevelStatus levels={tradeIdea.levels} entryPrice={tradeIdea.entryPrice} direction={tradeIdea.direction} />
        {!compact && (
          <div
            className="rounded-md p-3"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="mb-2 text-[0.5625rem] font-medium uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              Returns Curve
            </div>
            <ReturnsCurve returns={tradeIdea.returns} levels={tradeIdea.levels} />
          </div>
        )}
      </div>

      <LearnLink />
    </SectionBlock>
  );
}
