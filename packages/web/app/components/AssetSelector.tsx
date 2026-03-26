import { Link } from "react-router";

export function AssetSelector({ current }: { current: string }) {
  const assets = ["BTC", "ETH"];

  return (
    <div className="flex items-center gap-0">
      {assets.map((a) => {
        const isActive = current === a;
        return (
          <Link
            key={a}
            to={`/?asset=${a}`}
            className={`relative shrink-0 px-3 py-2 text-xs font-medium tracking-wide transition-colors ${isActive ? "tab-active" : ""}`}
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {a}
          </Link>
        );
      })}
    </div>
  );
}
