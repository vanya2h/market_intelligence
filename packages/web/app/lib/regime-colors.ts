export function regimeColor(regime: string): {
  color: string;
  arrow: string;
} {
  const lower = regime.toLowerCase();

  if (
    lower.includes("bullish") ||
    lower.includes("inflow") ||
    lower.includes("greed") ||
    lower.includes("squeeze")
  ) {
    return { color: "var(--green)", arrow: "\u2197" };
  }

  if (
    lower.includes("bearish") ||
    lower.includes("outflow") ||
    lower.includes("fear") ||
    lower.includes("capitulation") ||
    lower.includes("deleveraging")
  ) {
    return { color: "var(--red)", arrow: "\u2198" };
  }

  if (
    lower.includes("divergence") ||
    lower.includes("heating") ||
    lower.includes("unwinding") ||
    lower.includes("crowded") ||
    lower.includes("extended")
  ) {
    return { color: "var(--amber)", arrow: "\u2192" };
  }

  return { color: "var(--text-secondary)", arrow: "\u2192" };
}

export function sentimentColor(value: number): string {
  if (value <= 25) return "var(--red)";
  if (value <= 40) return "var(--red)";
  if (value <= 60) return "var(--amber)";
  if (value <= 75) return "var(--green)";
  return "var(--green)";
}
