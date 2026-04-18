/**
 * PriceDelta — shows how price has moved since the brief was generated.
 *
 * Displays: snapshot price (at brief time) → live price → delta + %
 * Fetches live price from /api/price/:asset on mount and every 30s.
 */

import { AssetType } from "@market-intel/api";
import { useEffect, useState } from "react";
import { api } from "../lib/api.client";
import { getAssetPrice } from "../lib/asset";
import { RelativeTime } from "./RelativeTime";
import { UsdValue } from "./UsdValue";

interface PriceDeltaProps {
  asset: AssetType;
  snapshotPrice: number;
  timestamp: Date;
}

export function PriceDelta({ asset, snapshotPrice, timestamp }: PriceDeltaProps) {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        const data = await getAssetPrice(asset)(api);
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
          padding: "0.625rem 0.875rem",
          background: "var(--bg-surface)",
          borderRadius: "6px",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontSize: "0.625rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Brief price
        </span>
        <UsdValue
          value={snapshotPrice}
          style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}
        />
        <RelativeTime date={new Date(timestamp)} style={{ fontSize: "0.625rem", color: "var(--text-muted)" }} />
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
        padding: "0.625rem 0.875rem",
        background: "var(--bg-surface)",
        borderRadius: "6px",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        flexWrap: "wrap",
      }}
    >
      {/* Snapshot price */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span
          style={{
            fontSize: "0.625rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Brief
        </span>
        <UsdValue value={snapshotPrice} style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }} />
      </div>

      {/* Arrow separator */}
      <span
        style={{
          margin: "0 0.25rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        →
      </span>

      {/* Live price */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span
          style={{
            fontSize: "0.625rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Now
        </span>
        <UsdValue value={livePrice} style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }} />
      </div>

      {/* Delta badge */}
      <div
        style={{
          marginLeft: "0",
          padding: "0.1875rem 0.5rem",
          background: deltaBg,
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
        }}
      >
        <span style={{ fontSize: "0.6875rem", color: deltaColor }}>{arrow}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: deltaColor }}>{isPositive ? "+" : "-"}</span>
        <UsdValue value={Math.abs(delta)} style={{ fontSize: "0.75rem", fontWeight: 600, color: deltaColor }} />
        <span
          className="font-mono-jb"
          style={{
            fontSize: "0.6875rem",
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
          fontSize: "0.625rem",
          color: "var(--text-muted)",
        }}
      >
        brief <RelativeTime date={new Date(timestamp)} />
      </span>
    </div>
  );
}
