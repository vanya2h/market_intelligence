/**
 * PriceDelta — shows how price has moved since the brief was generated.
 *
 * Displays: snapshot price (at brief time) → live price → delta + %
 * Fetches live price from /api/price/:asset on mount and every 30s.
 */

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { parseResponse } from "hono/client";
import { api } from "../lib/api.client";
import { UsdValue } from "./UsdValue";

interface PriceDeltaProps {
  asset: "BTC" | "ETH";
  snapshotPrice: number;
  briefTimestamp: string;
}

export function PriceDelta({ asset, snapshotPrice, briefTimestamp }: PriceDeltaProps) {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        const res = api.api.price[":asset"].$get({ param: { asset } });
        const data = await parseResponse(res);
        if (!cancelled) {
          setLivePrice(data.price);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, 1_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [asset]);

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
        <UsdValue value={snapshotPrice} style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }} />
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
        gap: "6px",
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
        <UsdValue value={snapshotPrice} style={{ fontSize: "13px", color: "var(--text-secondary)" }} />
      </div>

      {/* Arrow separator */}
      <span
        style={{
          margin: "0 4px",
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
        <UsdValue value={livePrice} style={{ fontSize: "13px", color: "var(--text-secondary)" }} />
      </div>

      {/* Delta badge */}
      <div
        style={{
          marginLeft: "0",
          padding: "3px 8px",
          background: deltaBg,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span style={{ fontSize: "11px", color: deltaColor }}>{arrow}</span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: deltaColor }}>{isPositive ? "+" : "-"}</span>
        <UsdValue value={Math.abs(delta)} style={{ fontSize: "12px", fontWeight: 600, color: deltaColor }} />
        <span
          className="font-mono-jb"
          style={{
            fontSize: "11px",
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
