import { regimeColor } from "../lib/regime-colors";

export function RegimeBadge({ regime }: { regime: string }) {
  const { color, arrow } = regimeColor(regime);

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium"
      style={{ color }}
    >
      {regime}
      <span className="text-[10px]">{arrow}</span>
    </span>
  );
}
