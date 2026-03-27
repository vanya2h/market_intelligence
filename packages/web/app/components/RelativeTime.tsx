import { useState, useEffect } from "react";
import { formatDistanceToNowStrict } from "date-fns";

/**
 * Client-only relative time display that avoids SSR hydration mismatch.
 *
 * On the server (and first client render), shows a static fallback.
 * After hydration, shows the live relative time and optionally refreshes.
 */
export function RelativeTime({
  date,
  className,
  style,
}: {
  date: Date | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const d = typeof date === "string" ? new Date(date) : date;
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(formatDistanceToNowStrict(d, { addSuffix: true }));
    const id = setInterval(() => {
      setLabel(formatDistanceToNowStrict(d, { addSuffix: true }));
    }, 60_000);
    return () => clearInterval(id);
  }, [d.getTime()]);

  if (!label) return null;

  return (
    <span className={className} style={style}>
      {label}
    </span>
  );
}
