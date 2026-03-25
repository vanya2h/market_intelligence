import { Link } from "react-router";

export function AssetSelector({ current }: { current: string }) {
  const assets = ["BTC", "ETH"];

  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
      {assets.map((a) => (
        <Link
          key={a}
          to={`/?asset=${a}`}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            current === a
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {a}
        </Link>
      ))}
    </div>
  );
}
