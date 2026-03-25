import { sentimentBg, sentimentColor } from "../lib/regime-colors";

export function SentimentGauge({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const color = sentimentColor(value);
  const bg = sentimentBg(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className={`text-3xl font-bold font-mono ${color}`}>
          {value.toFixed(1)}
        </span>
        <span className="text-sm text-zinc-400">{label}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${bg} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
