import { regimeColor } from "../lib/regime-colors";

export function RegimeBadge({ regime }: { regime: string }) {
  const { bg, text, border } = regimeColor(regime);
  return (
    <span
      className={`inline-block rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${bg} ${text} ${border}`}
    >
      {regime}
    </span>
  );
}
