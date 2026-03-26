/**
 * UsdValue — renders a formatted USD price in monospace style.
 *
 * Supports full precision (e.g. $87,432.15) and compact notation ($1.2B).
 * Automatically adjusts decimal places based on magnitude unless overridden.
 */

interface UsdValueProps {
  value: number;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function formatFullPrice(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 10 ? 2 : 0,
  });
}

function formatCompactPrice(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function UsdValue({ value, compact = false, className, style }: UsdValueProps) {
  const formatted = compact ? formatCompactPrice(value) : formatFullPrice(value);

  return (
    <span
      className={`font-mono-jb tabular-nums ${className ?? ""}`}
      style={style}
    >
      {formatted}
    </span>
  );
}
