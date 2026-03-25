export function regimeColor(regime: string): {
  bg: string;
  text: string;
  border: string;
} {
  const lower = regime.toLowerCase();

  if (
    lower.includes("bullish") ||
    lower.includes("inflow") ||
    lower.includes("greed") ||
    lower.includes("squeeze")
  ) {
    return { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30" };
  }

  if (
    lower.includes("bearish") ||
    lower.includes("outflow") ||
    lower.includes("fear") ||
    lower.includes("capitulation") ||
    lower.includes("deleveraging")
  ) {
    return { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30" };
  }

  if (
    lower.includes("divergence") ||
    lower.includes("heating") ||
    lower.includes("unwinding") ||
    lower.includes("crowded") ||
    lower.includes("extended")
  ) {
    return { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" };
  }

  return { bg: "bg-zinc-700/30", text: "text-zinc-400", border: "border-zinc-600/30" };
}

export function sentimentColor(value: number): string {
  if (value <= 20) return "text-red-400";
  if (value <= 40) return "text-orange-400";
  if (value <= 60) return "text-amber-400";
  if (value <= 80) return "text-emerald-400";
  return "text-green-400";
}

export function sentimentBg(value: number): string {
  if (value <= 20) return "bg-red-500";
  if (value <= 40) return "bg-orange-500";
  if (value <= 60) return "bg-amber-500";
  if (value <= 80) return "bg-emerald-500";
  return "bg-green-500";
}
