import { Link } from "react-router";

export function AssetSelector({ current }: { current: string }) {
  const assets = ["BTC", "ETH"];

  return (
    <div className="flex items-center gap-0.5">
      {assets.map((a) => (
        <Link
          key={a}
          to={`/?asset=${a}`}
          className={`px-3 py-1 text-xs font-medium tracking-wide transition-colors ${
            current === a
              ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          {a}
        </Link>
      ))}
    </div>
  );
}
