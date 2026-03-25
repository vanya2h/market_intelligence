/**
 * PriceDelta — shows how price has moved since the brief was generated.
 *
 * Displays: snapshot price (at brief time) → live price → delta + %
 * Fetches live price from /api/price/:asset on mount and every 30s.
 */

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";

interface PriceDeltaProps {
  asset: string;
  snapshotPrice: number;
  briefTimestamp: string;
  apiUrl?: string;
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: price < 10 ? 2 : 0,
  });
}


export function PriceDelta({ asset, snapshotPrice, briefTimestamp, apiUrl }: PriceDeltaProps) {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const base = apiUrl ?? "";

    async function fetchPrice() {
      try {
        const res = await fetch(`${base}/api/price/${asset}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json() as { price: number };
        if (!cancelled) {
          setLivePrice(data.price);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [asset, apiUrl]);

  if (error || livePrice === null) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--bg-surface)",
          borderRadius: "6px",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Brief price
        </span>
        <span
          style={{
            fontSize: "14px",
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: "var(--text-primary)",
          }}
        >
          {formatPrice(snapshotPrice)}
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {formatDistanceToNowStrict(new Date(briefTimestamp), { addSuffix: true })}
        </span>
      </div>
    );
  }

  const delta = livePrice - snapshotPrice;
  const deltaPct = (delta / snapshotPrice) * 100;
  const isPositive = delta >= 0;
  const deltaColor = isPositive ? "var(--green)" : "var(--red)";
  const deltaBg = isPositive ? "var(--green-dim)" : "var(--red-dim)";
  const arrow = isPositive ? "↑" : "↓";

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "var(--bg-surface)",
        borderRadius: "6px",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: "0",
        flexWrap: "wrap",
      }}
    >
      {/* Snapshot price */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Brief
        </span>
        <span
          style={{
            fontSize: "13px",
            fontFamily: "'JetBrains Mono', monospace",
            color: "var(--text-secondary)",
          }}
        >
          {formatPrice(snapshotPrice)}
        </span>
      </div>

      {/* Arrow separator */}
      <span
        style={{
          margin: "0 10px",
          fontSize: "12px",
          color: "var(--text-muted)",
        }}
      >
        →
      </span>

      {/* Live price */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Now
        </span>
        <span
          style={{
            fontSize: "14px",
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: "var(--text-primary)",
          }}
        >
          {formatPrice(livePrice)}
        </span>
      </div>

      {/* Delta badge */}
      <div
        style={{
          marginLeft: "12px",
          padding: "3px 8px",
          background: deltaBg,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span style={{ fontSize: "11px", color: deltaColor }}>{arrow}</span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            color: deltaColor,
          }}
        >
          {isPositive ? "+" : ""}
          {formatPrice(Math.abs(delta))}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: deltaColor,
            opacity: 0.8,
          }}
        >
          ({isPositive ? "+" : ""}
          {deltaPct.toFixed(2)}%)
        </span>
      </div>

      {/* Time ago */}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "10px",
          color: "var(--text-muted)",
        }}
      >
        brief {formatDistanceToNowStrict(new Date(briefTimestamp), { addSuffix: true })}
      </span>
    </div>
  );
}
