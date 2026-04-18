import type { Regime } from "@market-intel/api";
import { regimeColor, regimeLabel } from "../lib/regime-colors";

export function RegimeBadge({ regime }: { regime: Regime }) {
  const { color, arrow } = regimeColor(regime);

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      {regimeLabel(regime)}
      <span className="text-[0.625rem]">{arrow}</span>
    </span>
  );
}
