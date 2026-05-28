import type { AssetType, LevelMatrixResponse, MatrixCellData } from "@market-intel/api";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { AppHeader } from "../components/AppHeader";
import { StickyFooter } from "../components/StickyFooter";
import { getLevelMatrix } from "../lib/level-matrix";
import { api } from "../server/api.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") ?? "BTC") as AssetType;
  const horizon = Math.max(1, Math.min(8760, Number(url.searchParams.get("horizon") ?? "168")));

  const matrix = await getLevelMatrix(asset, horizon)(api).catch(() => null);
  return { asset, horizon, matrix };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Metric = "ev" | "winRate" | "rr";

function cellValue(cell: MatrixCellData, metric: Metric): number {
  if (metric === "ev") return cell.ev;
  if (metric === "winRate") return cell.winRate * 100 - 50; // center at 50 for coloring
  return cell.rr - 1; // center at 1 for coloring
}

function cellLabel(cell: MatrixCellData, metric: Metric): string {
  if (metric === "ev") return `${cell.ev >= 0 ? "+" : ""}${cell.ev.toFixed(2)}%`;
  if (metric === "winRate") return `${(cell.winRate * 100).toFixed(0)}% (n=${cell.n})`;
  return `${cell.rr.toFixed(2)}:1`;
}

function cellColor(val: number, threshold: number): string {
  if (val >= threshold) return "var(--green)";
  if (val > 0) return "color-mix(in srgb, var(--green) 50%, var(--text-secondary))";
  if (val <= -threshold) return "var(--red)";
  return "var(--red)";
}

function signedPct(v: number, decimals = 2): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

// ─── Matrix table ─────────────────────────────────────────────────────────────

function MatrixTable({
  matrix,
  metric,
  title,
}: {
  matrix: LevelMatrixResponse;
  metric: Metric;
  title: string;
}) {
  const threshold = metric === "ev" ? 0.1 : metric === "winRate" ? 5 : 0.3;

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono-jb border-collapse">
          <thead>
            <tr>
              <th
                className="px-3 py-2 text-left text-[0.65rem] font-medium"
                style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}
              >
                Stop ╲ Target
              </th>
              {matrix.targetLabels.map((t) => (
                <th
                  key={t}
                  className="px-3 py-2 text-center text-[0.65rem] font-semibold"
                  style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.stopLabels.map((stop, si) => (
              <tr key={stop} style={{ background: si % 2 === 0 ? "transparent" : "var(--bg-surface)" }}>
                <td
                  className="px-3 py-2 text-[0.65rem] font-semibold"
                  style={{ color: "var(--text-secondary)", borderRight: "1px solid var(--border-subtle)" }}
                >
                  {stop}
                </td>
                {matrix.targetLabels.map((target) => {
                  const cell = matrix.cells[stop]?.[target];
                  if (!cell || cell.n < 2) {
                    return (
                      <td key={target} className="px-3 py-2 text-center" style={{ color: "var(--text-muted)" }}>
                        —
                      </td>
                    );
                  }
                  const val = cellValue(cell, metric);
                  const color = cellColor(val, threshold);
                  return (
                    <td key={target} className="px-3 py-2 text-center tabular-nums" style={{ color }}>
                      {cellLabel(cell, metric)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Detail table ─────────────────────────────────────────────────────────────

function DetailTable({ matrix }: { matrix: LevelMatrixResponse }) {
  const rows: { stop: string; target: string; cell: MatrixCellData }[] = [];
  for (const stop of matrix.stopLabels) {
    for (const target of matrix.targetLabels) {
      const cell = matrix.cells[stop]?.[target];
      if (cell && cell.n > 0) rows.push({ stop, target, cell });
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        Detailed breakdown
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono-jb border-collapse">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Combo", "N", "Wins", "Losses", "Open", "Win%", "AvgWin", "AvgLoss", "EV"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-[0.65rem] font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ stop, target, cell }, i) => {
              const resolved = cell.wins + cell.losses;
              const winPct = resolved > 0 ? (cell.wins / resolved) * 100 : 0;
              const evColor = cell.ev >= 0.1 ? "var(--green)" : cell.ev <= -0.1 ? "var(--red)" : "var(--text-secondary)";
              return (
                <tr
                  key={`${stop}-${target}`}
                  style={{ background: i % 2 === 0 ? "transparent" : "var(--bg-surface)" }}
                >
                  <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>
                    {target}×{stop}
                  </td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{cell.n}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--green)" }}>{cell.wins}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--red)" }}>{cell.losses}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-muted)" }}>{cell.open}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {winPct.toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--green)" }}>
                    {signedPct(cell.avgWin)}
                  </td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--red)" }}>
                    {signedPct(cell.avgLoss)}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: evColor }}>
                    {signedPct(cell.ev)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Controls ─────────────────────────────────────────────────────────────────

const HORIZON_OPTIONS = [
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 72, label: "72h" },
  { value: 168, label: "168h (1w)" },
  { value: 336, label: "336h (2w)" },
  { value: 720, label: "720h (1mo)" },
];

const ASSETS: AssetType[] = ["BTC", "ETH"];

function Controls({ asset, horizon }: { asset: AssetType; horizon: number }) {
  const navigation = useNavigation();
  const loading = navigation.state === "loading";

  return (
    <Form method="get" className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-[0.65rem] font-medium" style={{ color: "var(--text-muted)" }}>
          Asset
        </span>
        <div className="flex gap-1">
          {ASSETS.map((a) => (
            <button
              key={a}
              type="submit"
              name="asset"
              value={a}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (form) {
                  const horizonInput = form.querySelector<HTMLInputElement>('input[name="horizon"]');
                  if (horizonInput) horizonInput.value = String(horizon);
                }
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded transition-colors"
              style={{
                background: asset === a ? "var(--bg-active)" : "var(--bg-surface)",
                color: asset === a ? "var(--text-primary)" : "var(--text-muted)",
                border: `1px solid ${asset === a ? "var(--border)" : "var(--border-subtle)"}`,
              }}
            >
              {a}
            </button>
          ))}
        </div>
        <input type="hidden" name="horizon" value={horizon} />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[0.65rem] font-medium" style={{ color: "var(--text-muted)" }}>
          Horizon
        </span>
        <div className="flex gap-1 flex-wrap">
          {HORIZON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="submit"
              name="horizon"
              value={opt.value}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (form) {
                  const assetInput = form.querySelector<HTMLInputElement>('input[name="asset"]');
                  if (assetInput) assetInput.value = asset;
                }
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded transition-colors"
              style={{
                background: horizon === opt.value ? "var(--bg-active)" : "var(--bg-surface)",
                color: horizon === opt.value ? "var(--text-primary)" : "var(--text-muted)",
                border: `1px solid ${horizon === opt.value ? "var(--border)" : "var(--border-subtle)"}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input type="hidden" name="asset" value={asset} />
      </div>

      {loading && (
        <span className="text-[0.65rem]" style={{ color: "var(--text-muted)" }}>
          Loading…
        </span>
      )}
    </Form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LevelMatrixPage() {
  const { asset, horizon, matrix } = useLoaderData<LoaderData>();

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader>
        <Controls asset={asset} horizon={horizon} />
      </AppHeader>

      <main className="flex flex-col gap-8 p-4 md:p-6 max-w-5xl w-full">
        <div>
          <h1 className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            Level Return Matrix
          </h1>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            For each (target, stop) combination, simulates trade outcomes using actual price series.
            Close-price hit detection: first touch wins. Open trades use last recorded price at horizon.
          </p>
        </div>

        {!matrix ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Failed to load matrix data.
          </p>
        ) : (
          <>
            <div
              className="flex gap-6 text-xs flex-wrap"
              style={{ color: "var(--text-muted)" }}
            >
              <span>
                <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {matrix.totalIdeas}
                </span>{" "}
                trade ideas
              </span>
              {matrix.skippedNoLevels > 0 && (
                <span>{matrix.skippedNoLevels} skipped — no levels</span>
              )}
              {matrix.skippedNoReturns > 0 && (
                <span>{matrix.skippedNoReturns} skipped — no return data</span>
              )}
            </div>

            <div className="flex flex-col gap-8">
              <MatrixTable matrix={matrix} metric="ev" title="Expected Value (avg P&L % incl. open)" />
              <MatrixTable matrix={matrix} metric="winRate" title="Win Rate (target hit before stop, resolved only)" />
              <MatrixTable matrix={matrix} metric="rr" title="Risk:Reward (avg win ÷ avg loss)" />
              <DetailTable matrix={matrix} />
            </div>
          </>
        )}
      </main>

      <StickyFooter />
    </div>
  );
}
