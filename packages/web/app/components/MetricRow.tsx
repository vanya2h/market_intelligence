export function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-sm text-zinc-200">{value}</span>
    </div>
  );
}
