import type { TradeIdeaLevel, TradeDirection } from "@market-intel/api";
import { UsdValue } from "./UsdValue";

function outcomeIcon(outcome: string): string {
  if (outcome === "WIN") return "\u2713";
  if (outcome === "LOSS") return "\u2717";
  return "\u2022";
}

function outcomeColor(outcome: string): string {
  if (outcome === "WIN") return "var(--green)";
  if (outcome === "LOSS") return "var(--red)";
  return "var(--text-muted)";
}

function typeColor(type: string): string {
  return type === "TARGET" ? "var(--green)" : "var(--red)";
}

function typeLabel(type: string): string {
  return type === "TARGET" ? "TGT" : "INV";
}

export function LevelStatus({
  levels,
  entryPrice,
  direction,
}: {
  levels: TradeIdeaLevel[];
  entryPrice: number;
  direction: TradeDirection;
}) {
  // Sort levels by price descending (targets at top, invalidations at bottom for LONG)
  const sorted = [...levels].sort((a, b) => {
    if (direction === "FLAT") {
      // For FLAT, group by type then label
      if (a.type !== b.type) return a.type === "INVALIDATION" ? -1 : 1;
      return a.label.localeCompare(b.label);
    }
    return b.price - a.price;
  });

  return (
    <div
      className="rounded-md text-[0.6875rem]"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {sorted.map((level, i) => {
        // Insert entry price divider at the right position
        const prevLevel = sorted[i - 1];
        const showEntry =
          direction !== "FLAT" &&
          i > 0 &&
          prevLevel &&
          prevLevel.price >= entryPrice &&
          level.price < entryPrice;

        return (
          <div key={`${level.type}-${level.label}`}>
            {showEntry && (
              <div
                className="flex items-center gap-2 px-3 py-1.5"
                style={{
                  borderTop: "1px dashed var(--border)",
                  borderBottom: "1px dashed var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                <span className="text-[0.5625rem] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Entry
                </span>
                <span className="grow" />
                <UsdValue value={entryPrice} style={{ fontSize: "0.6875rem" }} />
              </div>
            )}
            <div
              className="flex items-center gap-2 px-3 py-1.5"
              style={{
                borderTop: i > 0 && !showEntry ? "1px solid var(--border-subtle)" : undefined,
              }}
            >
              {/* Type badge */}
              <span
                className="rounded px-1 py-px text-[0.5rem] font-bold uppercase tracking-wider"
                style={{
                  color: typeColor(level.type),
                  background: level.type === "TARGET" ? "var(--green-dim)" : "var(--red-dim)",
                }}
              >
                {typeLabel(level.type)}
              </span>

              {/* Label */}
              <span className="font-mono-jb font-medium" style={{ color: "var(--text-primary)" }}>
                {level.label}
              </span>

              <span className="grow" />

              {/* Price */}
              {direction !== "FLAT" ? (
                <UsdValue value={level.price} style={{ color: "var(--text-primary)", fontSize: "0.6875rem" }} />
              ) : (
                <span className="font-mono-jb tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {"\u00B1"}{level.price.toFixed(0)}
                </span>
              )}

              {/* Outcome */}
              <span
                className="ml-1 font-mono-jb font-bold"
                style={{ color: outcomeColor(level.outcome) }}
              >
                {outcomeIcon(level.outcome)}
              </span>
            </div>
          </div>
        );
      })}

      {/* Entry at bottom if all levels are above (shouldn't happen, but safe) */}
      {direction !== "FLAT" && !sorted.some((l) => l.price < entryPrice) && (
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{
            borderTop: "1px dashed var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <span className="text-[0.5625rem] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Entry
          </span>
          <span className="grow" />
          <UsdValue value={entryPrice} style={{ fontSize: "0.6875rem" }} />
        </div>
      )}
    </div>
  );
}
