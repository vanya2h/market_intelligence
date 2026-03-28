import type { TradeIdea, TradeIdeaReturn } from "@market-intel/api";
import { SectionBlock } from "./SectionBlock";
import { UsdValue } from "./UsdValue";
import { InlineLink } from "./InlineLink";
import { ConfluenceBadges, ConfluenceBreakdown } from "./ConfluenceBadges";
import { LevelStatus } from "./LevelStatus";
import { ReturnsCurve } from "./ReturnsCurve";

/**
 * Shows how wrong a skip decision was.
 * Uses peak quality (returnPct × e^(-t/72)) — fast moves score high, slow moves decay.
 */
function MissedMoveIndicator({ peak, lastReturn }: { peak: TradeIdeaReturn; lastReturn: TradeIdeaReturn | null }) {
  const absQuality = Math.abs(peak.qualityAtPoint);
  const severity = absQuality >= 3 ? "bad" : absQuality >= 1 ? "notable" : "negligible";
  const severityColor =
    severity === "bad" ? "var(--red)" : severity === "notable" ? "var(--amber)" : "var(--text-muted)";
  const severityLabel =
    severity === "bad" ? "Significant miss" : severity === "notable" ? "Missed move" : "No significant move";

  const peakHours = peak.hoursAfter;
  const peakTime = peakHours < 24 ? `${peakHours}h` : `${Math.floor(peakHours / 24)}d`;

  return (
    <div
      className="mt-2 rounded px-3 py-2 flex items-center gap-3 flex-wrap text-[0.625rem]"
      style={{
        background: `color-mix(in srgb, ${severityColor} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${severityColor} 20%, transparent)`,
      }}
    >
      <span className="font-medium uppercase tracking-wider" style={{ color: severityColor }}>
        {severityLabel}
      </span>
      <span style={{ color: "var(--text-muted)" }}>
        Peak{" "}
        <span className="font-mono-jb font-semibold" style={{ color: severityColor }}>
          {peak.returnPct >= 0 ? "+" : ""}
          {peak.returnPct.toFixed(2)}%
        </span>{" "}
        at {peakTime}
        <span style={{ opacity: 0.6 }}> (quality: {peak.qualityAtPoint.toFixed(2)})</span>
      </span>
      {lastReturn && (
        <span className="ml-auto font-mono-jb" style={{ color: "var(--text-muted)" }}>
          Now: {lastReturn.returnPct >= 0 ? "+" : ""}
          {lastReturn.returnPct.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

function LearnLink() {
  return (
    <InlineLink to="/faq#trade-ideas" className="mt-3 inline-flex items-center gap-1 text-[0.8rem]">
      Learn how it works <span>{"\u2192"}</span>
    </InlineLink>
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

/** Skipped trade idea — just a banner with confluence scores */
function SkippedTradeIdea({ tradeIdea }: { tradeIdea: TradeIdea }) {
  const dir = directionStyle(tradeIdea.direction);
  const lastReturn = tradeIdea.returns.length > 0 ? tradeIdea.returns[tradeIdea.returns.length - 1] : null;
  const peakQuality =
    tradeIdea.returns.length > 0
      ? tradeIdea.returns.reduce((best, r) => (Math.abs(r.qualityAtPoint) > Math.abs(best.qualityAtPoint) ? r : best))
      : null;

  return (
    <SectionBlock
      title="Trade Idea"
      tooltip="Trade idea was computed but conviction was insufficient. Tracked for accuracy measurement."
    >
      <div
        className="rounded-md p-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Skip banner */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center rounded px-2 py-0.5 text-[0.625rem] font-bold font-mono-jb"
            style={{ color: dir.color, background: dir.bg, border: `1px solid ${dir.color}33`, opacity: 0.6 }}
          >
            {dir.label}
          </span>
          <span className="text-[0.6875rem] font-medium" style={{ color: "var(--text-muted)" }}>
            Trade skipped — low conviction
          </span>
        </div>

        {/* Confluence badges */}
        {tradeIdea.confluence && <ConfluenceBadges confluence={tradeIdea.confluence} />}

        {/* Missed move indicator if returns data exists */}
        {peakQuality && <MissedMoveIndicator peak={peakQuality} lastReturn={lastReturn ?? null} />}

        <LearnLink />
      </div>
    </SectionBlock>
  );
}

/** Active (taken) trade idea — full display */
export function TradeIdeaSection({ tradeIdea, compact }: { tradeIdea: TradeIdea; compact?: boolean }) {
  // Skipped ideas get a simple banner
  if (tradeIdea.skipped) {
    return <SkippedTradeIdea tradeIdea={tradeIdea} />;
  }

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

  return (
    <SectionBlock
      title="Trade Idea"
      tooltip="Directional trade idea taken when confluence conviction exceeds 200/400. Levels are tracked independently with time-decay quality scoring."
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
