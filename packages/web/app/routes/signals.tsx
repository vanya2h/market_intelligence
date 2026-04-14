import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AppHeader } from "../components/AppHeader";
import { Collapsible } from "../components/Collapsible";
import { StickyFooter } from "../components/StickyFooter";
import { AssetSelector } from "../components/AssetSelector";
import { getSignalEffectiveness, getPerformanceMetrics } from "../lib/trade-idea";
import { api } from "../server/api.server";
import { DIMENSION_SHORT_LABELS, type ConfluenceKey } from "../lib/dimensions";
import type { DimensionEffectiveness, SignalBucket, IdeaSummary, PerformanceMetrics, MonthlyReturn } from "@market-intel/api";
import { Link } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const asset = (url.searchParams.get("asset") || "BTC") as "BTC" | "ETH";
  const [data, performance] = await Promise.all([
    getSignalEffectiveness(asset, api),
    getPerformanceMetrics(asset, api),
  ]);
  return { asset, data, performance };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

export default function Signals() {
  const { asset, data, performance } = useLoaderData<LoaderData>();

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="flex flex-col w-full">
        {/* Subheader: asset selector */}
        <div
          className="sticky top-10 z-20 flex w-full  items-center gap-4 px-4 md:px-6"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Asset:
          </span>
          <AssetSelector className="h-full" current={asset} baseUrl="/signals" />
        </div>

        <div className="flex flex-col gap-6 py-6 px-4 md:px-6 md:max-w-4xl">
          {/* Header */}
          <div>
            <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Signal Effectiveness
            </h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Per-dimension score vs peak return velocity — identifies which signals predict fast moves.
            </p>
          </div>

          {/* Performance metrics */}
          {performance.totalIdeas > 0 && <PerformanceSection performance={performance} />}

          {/* Sample size banner */}
          <SampleSizeBanner totalIdeas={data.totalIdeas} totalWithReturns={data.totalWithReturns} />

          {/* Methodology guide */}
          <MethodologyGuide />

          {data.totalWithReturns < 3 ? (
            <div
              className="rounded-md p-6 text-center text-xs"
              style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
            >
              Not enough data yet. Need at least 3 trade ideas with return snapshots.
            </div>
          ) : (
            <>
              {/* Correlation ranking */}
              <CorrelationRanking dimensions={data.dimensions} />

              {/* Trade idea heatmap */}
              {data.ideas.length > 0 && <IdeaHeatmap ideas={data.ideas} />}

              {/* Per-dimension bucket tables */}
              <div className="flex flex-col gap-4">
                {data.dimensions.map((dim) => (
                  <DimensionTable key={dim.dimension} dim={dim} />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      <StickyFooter />
    </div>
  );
}

// ─── Performance metrics ────────────────────────────────────────────────────

function PerformanceSection({ performance: p }: { performance: PerformanceMetrics }) {
  const pnlColor = p.totalPnl >= 0 ? "var(--green)" : "var(--red)";
  const sharpeColor = p.sharpe === null ? "var(--text-muted)" : p.sharpe >= 1 ? "var(--green)" : p.sharpe >= 0 ? "var(--text-secondary)" : "var(--red)";

  return (
    <div
      className="rounded-md p-4 flex flex-col gap-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Performance
      </h2>

      {/* Summary stats row */}
      <div className="flex flex-wrap gap-6">
        <StatCell label="Cumulative PnL" value={`${p.totalPnl >= 0 ? "+" : ""}${p.totalPnl.toFixed(1)}`} color={pnlColor} />
        <StatCell label="Sharpe (ann.)" value={p.sharpe !== null ? p.sharpe.toFixed(2) : "—"} color={sharpeColor} />
        <StatCell label="Win Rate" value={`${(p.winRate * 100).toFixed(0)}%`} color="var(--text-primary)" />
        <StatCell label="Avg PnL / Idea" value={`${p.avgPnlPerIdea >= 0 ? "+" : ""}${p.avgPnlPerIdea.toFixed(2)}`} color={p.avgPnlPerIdea >= 0 ? "var(--green)" : "var(--red)"} />
        <StatCell label="Avg Size" value={`${p.avgSize.toFixed(2)}×`} color="var(--text-secondary)" />
        <StatCell label="Ideas" value={String(p.totalIdeas)} color="var(--text-secondary)" />
      </div>

      {/* Monthly breakdown */}
      {p.months.length > 0 && <MonthlyTable months={p.months} />}

      <p className="text-[0.5625rem]" style={{ color: "var(--text-muted)" }}>
        PnL = conviction multiplier × peak return. Size scales with conviction (2.0 × conv^1.5). Zero conviction = zero size.
      </p>
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <span className="text-[0.5625rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="font-mono-jb text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function MonthlyTable({ months }: { months: MonthlyReturn[] }) {
  const maxAbsPnl = Math.max(...months.map((m) => Math.abs(m.pnl)), 0.01);

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div
        className="grid grid-cols-[5rem_3rem_1fr_5rem_4rem_4rem] gap-2 items-center text-[0.5625rem] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        <span>Month</span>
        <span className="text-right">n</span>
        <span className="pl-2">PnL</span>
        <span className="text-right">Value</span>
        <span className="text-right">Win%</span>
        <span className="text-right">Avg Ret</span>
      </div>

      {months.map((m) => {
        const pnlColor = m.pnl >= 0 ? "var(--green)" : "var(--red)";
        const barWidth = maxAbsPnl > 0 ? (Math.abs(m.pnl) / maxAbsPnl) * 100 : 0;

        return (
          <div
            key={m.month}
            className="grid grid-cols-[5rem_3rem_1fr_5rem_4rem_4rem] gap-2 items-center py-1"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <span className="text-[0.625rem] font-medium font-mono-jb" style={{ color: "var(--text-secondary)" }}>
              {m.month}
            </span>
            <span className="text-right font-mono-jb text-[0.625rem]" style={{ color: "var(--text-secondary)" }}>
              {m.count}
            </span>
            <div className="relative h-4 flex items-center pl-2">
              <div
                className="h-2.5 rounded-sm"
                style={{
                  width: `${Math.max(barWidth, 2)}%`,
                  background: `color-mix(in srgb, ${pnlColor} 35%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${pnlColor} 55%, transparent)`,
                }}
              />
            </div>
            <span className="text-right font-mono-jb tabular-nums text-[0.625rem]" style={{ color: pnlColor }}>
              {m.pnl >= 0 ? "+" : ""}{m.pnl.toFixed(1)}
            </span>
            <span className="text-right font-mono-jb tabular-nums text-[0.625rem]" style={{ color: "var(--text-secondary)" }}>
              {(m.winRate * 100).toFixed(0)}%
            </span>
            <span
              className="text-right font-mono-jb tabular-nums text-[0.625rem]"
              style={{ color: m.avgReturn >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {m.avgReturn >= 0 ? "+" : ""}{m.avgReturn.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sample size banner ─────────────────────────────────────────────────────

function SampleSizeBanner({ totalIdeas, totalWithReturns }: { totalIdeas: number; totalWithReturns: number }) {
  const pct = totalIdeas > 0 ? Math.round((totalWithReturns / totalIdeas) * 100) : 0;
  const isLow = totalWithReturns < 10;

  return (
    <div
      className="rounded-md px-4 py-3 flex items-center gap-4 flex-wrap"
      style={{
        background: isLow ? "color-mix(in srgb, var(--yellow, #f0c040) 8%, transparent)" : "var(--bg-surface)",
        border: `1px solid ${isLow ? "color-mix(in srgb, var(--yellow, #f0c040) 25%, transparent)" : "var(--border-subtle)"}`,
      }}
    >
      <div className="flex items-center gap-6">
        <div>
          <span className="text-[0.5625rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
            Total Ideas
          </span>
          <span className="font-mono-jb text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {totalIdeas}
          </span>
        </div>
        <div>
          <span className="text-[0.5625rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
            With Returns
          </span>
          <span className="font-mono-jb text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {totalWithReturns}
          </span>
        </div>
        <div>
          <span className="text-[0.5625rem] uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
            Coverage
          </span>
          <span className="font-mono-jb text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {pct}%
          </span>
        </div>
      </div>

      {isLow && (
        <span className="text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
          Small sample — correlations and averages may be unreliable. Results stabilize around 30+ ideas.
        </span>
      )}
    </div>
  );
}

// ─── Methodology guide ──────────────────────────────────────────────────────

function MethodologyGuide() {
  return (
    <Collapsible title="How to read this page">
      <div className="flex flex-col gap-4 text-[0.6875rem] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {/* What we measure */}
        <div>
          <h3 className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            What is Peak Velocity?
          </h3>
          <p>
            Every trade idea is tracked by the outcome checker (runs twice daily), which fetches 4H candles from Binance
            since the last check. Each candle becomes a return snapshot with the actual hours elapsed from entry. Peak
            velocity picks the snapshot where the move was fastest:
          </p>
          <div
            className="mt-2 rounded px-3 py-2 font-mono-jb text-[0.625rem]"
            style={{ background: "var(--bg-hover)" }}
          >
            peak velocity = max(returnPct / hoursAfter)
          </div>
          <p className="mt-2">
            Signed by direction — positive means the price moved in the predicted direction. Higher velocity = the
            signal predicted a fast, strong move.
          </p>
        </div>

        {/* Example */}
        <div>
          <h3 className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            Example
          </h3>
          <p>A LONG idea is generated at $95,000. The outcome checker records 4H candle snapshots:</p>
          <div
            className="mt-2 rounded overflow-hidden text-[0.625rem] font-mono-jb"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            <div
              className="grid grid-cols-3 gap-2 px-3 py-1 text-[0.5625rem] uppercase"
              style={{ color: "var(--text-muted)", background: "var(--bg-hover)" }}
            >
              <span>Hours After</span>
              <span>Return</span>
              <span>Velocity</span>
            </div>
            {[
              ["4h", "+0.80%", "0.80 / 4 = 0.200"],
              ["8h", "+1.20%", "1.20 / 8 = 0.150"],
              ["12h", "+1.00%", "1.00 / 12 = 0.083"],
              ["24h", "+2.00%", "2.00 / 24 = 0.083"],
            ].map(([time, ret, calc]) => (
              <div
                key={time}
                className="grid grid-cols-3 gap-2 px-3 py-1"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <span>{time}</span>
                <span style={{ color: "var(--green)" }}>{ret}</span>
                <span style={{ color: "var(--text-muted)" }}>{calc}</span>
              </div>
            ))}
          </div>
          <p className="mt-2">
            Peak velocity ={" "}
            <span className="font-mono-jb" style={{ color: "var(--green)" }}>
              0.200
            </span>{" "}
            (the 4h snapshot wins — the move was fastest there). A +2% move in 24h scores 0.083, much lower than +0.8%
            in 4h, because speed matters.
          </p>
        </div>

        {/* Correlation chart */}
        <div>
          <h3 className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            Correlation Chart
          </h3>
          <p>
            Shows Pearson r between each dimension's confluence score (-100 to +100) and peak velocity across all trade
            ideas.
          </p>
          <ul className="mt-2 flex flex-col gap-1 pl-4" style={{ listStyleType: "disc" }}>
            <li>
              <span style={{ color: "var(--green)" }}>Positive r</span> — when this dimension scores high, the predicted
              move tends to happen fast. The signal is confirming and predictive.
            </li>
            <li>
              <span style={{ color: "var(--red)" }}>Negative r</span> — high scores are associated with slower or
              adverse moves. The signal is contrarian — by the time it agrees, the move may be exhausted.
            </li>
            <li>
              <span style={{ color: "var(--text-muted)" }}>Near zero</span> — the dimension's score has little
              relationship with outcome quality. It may be noise at the current pipeline cadence.
            </li>
          </ul>
        </div>

        {/* Bucket tables */}
        <div>
          <h3 className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            Bucket Tables
          </h3>
          <p>
            Each dimension's score range is split into 5 buckets. For each bucket, the table shows how many ideas fell
            in that range and the average peak velocity.
          </p>
          <ul className="mt-2 flex flex-col gap-1 pl-4" style={{ listStyleType: "disc" }}>
            <li>
              <strong>Strong For</strong> (50 to 100) — dimension strongly agrees with trade direction
            </li>
            <li>
              <strong>Strong Against</strong> (-100 to -50) — dimension strongly disagrees
            </li>
            <li>
              Look for a velocity gradient: if avg velocity increases from "Against" to "For", the dimension is
              predictive. If it's flat or inverted, the dimension may need less weight.
            </li>
          </ul>
        </div>

        {/* How to use */}
        <div>
          <h3 className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            How to use for weight tuning
          </h3>
          <ul className="flex flex-col gap-1 pl-4" style={{ listStyleType: "disc" }}>
            <li>
              Dimensions with high positive correlation and clear velocity gradients deserve more weight in the
              confluence system.
            </li>
            <li>
              Dimensions with negative correlation may be lagging indicators — consider reducing weight or investigating
              if they only fail at extremes.
            </li>
            <li>
              Check bucket sample sizes (n) — a bucket with n=2 is noise, not signal. Minimum ~5 samples per bucket
              before drawing conclusions.
            </li>
          </ul>
        </div>
      </div>
    </Collapsible>
  );
}

// ─── Trade idea heatmap ─────────────────────────────────────────────────────

function IdeaHeatmap({ ideas }: { ideas: IdeaSummary[] }) {
  // Sort chronologically (oldest first)
  const sorted = [...ideas].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Compute max absolute quality for scaling
  const qualities = sorted.map((i) => i.peakQuality).filter((q): q is number => q !== null);
  const maxAbsQ = qualities.length > 0 ? Math.max(...qualities.map(Math.abs), 0.01) : 1;

  return (
    <div
      className="rounded-md p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <h2
        className="text-[0.6875rem] font-medium uppercase tracking-wider mb-3"
        style={{ color: "var(--text-muted)" }}
      >
        Trade Idea History
      </h2>

      {/* Grid */}
      <div className="flex flex-wrap gap-1">
        {sorted.map((idea) => (
          <HeatmapCell key={idea.id} idea={idea} maxAbsQ={maxAbsQ} />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-[0.5625rem]" style={{ color: "var(--text-muted)" }}>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: "color-mix(in srgb, var(--green) 50%, transparent)" }}
          />
          <span>Predicted move hit fast</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: "color-mix(in srgb, var(--red) 50%, transparent)" }}
          />
          <span>Adverse / wrong direction</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: "var(--bg-hover)", border: "1px solid var(--border-subtle)" }}
          />
          <span>No data / negligible</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: "var(--bg-hover)", border: "1px dashed var(--text-muted)" }}
          />
          <span>Skipped</span>
        </div>
      </div>
    </div>
  );
}

function HeatmapCell({ idea, maxAbsQ }: { idea: IdeaSummary; maxAbsQ: number }) {
  const q = idea.peakQuality;
  const hasData = q !== null;
  const intensity = hasData ? Math.min(Math.abs(q) / maxAbsQ, 1) : 0;
  const isPositive = hasData && q > 0;

  // Color: green for positive quality (predicted move happened), red for negative
  const baseColor = !hasData
    ? "var(--bg-hover)"
    : isPositive
      ? `color-mix(in srgb, var(--green) ${Math.round(15 + intensity * 55)}%, transparent)`
      : `color-mix(in srgb, var(--red) ${Math.round(15 + intensity * 55)}%, transparent)`;

  const borderColor = !hasData
    ? "var(--border-subtle)"
    : isPositive
      ? `color-mix(in srgb, var(--green) ${Math.round(30 + intensity * 40)}%, transparent)`
      : `color-mix(in srgb, var(--red) ${Math.round(30 + intensity * 40)}%, transparent)`;

  const date = new Date(idea.createdAt);
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const dirLabel = idea.direction === "LONG" ? "\u25b2" : idea.direction === "SHORT" ? "\u25bc" : "\u2014";
  const returnStr = idea.peakReturnPct !== null ? `${idea.peakReturnPct > 0 ? "+" : ""}${idea.peakReturnPct.toFixed(1)}%` : "";
  const timeToStr = idea.peakHoursAfter !== null
    ? idea.peakHoursAfter < 24
      ? `${idea.peakHoursAfter}h`
      : `${Math.floor(idea.peakHoursAfter / 24)}d`
    : "";
  const qualityStr = q !== null ? `q=${q.toFixed(2)}` : "";

  const tooltip = [
    `${dateStr} ${timeStr}`,
    idea.direction,
    returnStr && `Peak: ${returnStr} at ${timeToStr}`,
    qualityStr,
  ]
    .filter(Boolean)
    .join(" · ");

  const cellLabel = hasData ? q.toFixed(1) : dirLabel;

  return (
    <Link
      to={`/brief/${idea.briefId}`}
      title={tooltip}
      className="relative h-7 w-7 rounded-sm flex items-center justify-center text-[0.4375rem] font-mono-jb transition-transform hover:scale-125 hover:z-10"
      style={{
        background: baseColor,
        border: `1px solid ${borderColor}`,
        color: !hasData
          ? "var(--text-muted)"
          : isPositive
            ? "var(--green)"
            : "var(--red)",
      }}
    >
      {cellLabel}
    </Link>
  );
}

// ─── Correlation ranking ────────────────────────────────────────────────────

function CorrelationRanking({ dimensions }: { dimensions: DimensionEffectiveness[] }) {
  const sorted = [...dimensions]
    .filter((d) => d.correlation !== null)
    .sort((a, b) => Math.abs(b.correlation!) - Math.abs(a.correlation!));

  if (sorted.length === 0) return null;

  const maxAbs = Math.max(...sorted.map((d) => Math.abs(d.correlation!)));

  return (
    <div
      className="rounded-md p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
        Correlation with Peak Velocity
      </h2>
      <div className="flex flex-col gap-2">
        {sorted.map((dim) => {
          const r = dim.correlation!;
          const label = DIMENSION_SHORT_LABELS[dim.dimension as ConfluenceKey] ?? dim.dimension;
          const barWidth = maxAbs > 0 ? (Math.abs(r) / maxAbs) * 100 : 0;
          const color = r > 0 ? "var(--green)" : "var(--red)";

          return (
            <div key={dim.dimension} className="flex items-center gap-3">
              <span
                className="text-[0.6875rem] font-medium w-14 text-right shrink-0"
                style={{ color: "var(--text-secondary)" }}
              >
                {label}
              </span>
              <div className="flex-1 flex items-center h-5">
                {/* Center line */}
                <div className="relative w-full h-full flex items-center">
                  <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: "var(--border)" }} />
                  {/* Bar */}
                  <div
                    className="absolute h-3 rounded-sm"
                    style={{
                      background: `color-mix(in srgb, ${color} 40%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${color} 60%, transparent)`,
                      width: `${barWidth / 2}%`,
                      ...(r >= 0 ? { left: "50%" } : { right: "50%" }),
                    }}
                  />
                </div>
              </div>
              <span className="font-mono-jb tabular-nums text-[0.625rem] w-12 text-right shrink-0" style={{ color }}>
                {r > 0 ? "+" : ""}
                {r.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[0.5625rem] mt-3" style={{ color: "var(--text-muted)" }}>
        Pearson r: positive = higher dimension score predicts faster directional moves. Negative = contrarian signal.
      </p>
    </div>
  );
}

// ─── Per-dimension bucket table ─────────────────────────────────────────────

const BUCKET_LABELS: Record<string, string> = {
  strong_against: "Strong Against",
  weak_against: "Weak Against",
  neutral: "Neutral",
  weak_for: "Weak For",
  strong_for: "Strong For",
};

function DimensionTable({ dim }: { dim: DimensionEffectiveness }) {
  const label = DIMENSION_SHORT_LABELS[dim.dimension as ConfluenceKey] ?? dim.dimension;
  const maxCount = Math.max(...dim.buckets.map((b) => b.count), 1);
  const velocities = dim.buckets.map((b) => b.avgVelocity).filter((v): v is number => v !== null);
  const maxVel = velocities.length > 0 ? Math.max(...velocities.map(Math.abs)) : 1;

  return (
    <div
      className="rounded-md p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[0.6875rem] font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </h2>
        <span className="font-mono-jb text-[0.5625rem]" style={{ color: "var(--text-muted)" }}>
          n={dim.sampleSize}
        </span>
        {dim.correlation !== null && (
          <span
            className="font-mono-jb text-[0.5625rem]"
            style={{ color: dim.correlation > 0 ? "var(--green)" : "var(--red)" }}
          >
            r={dim.correlation > 0 ? "+" : ""}
            {dim.correlation.toFixed(2)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {/* Header */}
        <div
          className="grid grid-cols-[8rem_3rem_1fr_5rem] gap-2 items-center text-[0.5625rem] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          <span>Score Range</span>
          <span className="text-right">n</span>
          <span className="pl-2">Avg Velocity</span>
          <span className="text-right">%/hr</span>
        </div>

        {dim.buckets.map((bucket) => (
          <BucketRow key={bucket.range} bucket={bucket} maxCount={maxCount} maxVel={maxVel} />
        ))}
      </div>
    </div>
  );
}

function BucketRow({ bucket, maxCount, maxVel }: { bucket: SignalBucket; maxCount: number; maxVel: number }) {
  const vel = bucket.avgVelocity;
  const velColor = vel === null ? "var(--text-muted)" : vel > 0 ? "var(--green)" : "var(--red)";
  const velBarWidth = vel !== null && maxVel > 0 ? (Math.abs(vel) / maxVel) * 100 : 0;

  return (
    <div
      className="grid grid-cols-[8rem_3rem_1fr_5rem] gap-2 items-center py-1 rounded"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-[0.625rem] font-medium" style={{ color: "var(--text-secondary)" }}>
        {BUCKET_LABELS[bucket.range] ?? bucket.range}
        <span className="font-mono-jb text-[0.5rem] ml-1" style={{ color: "var(--text-muted)" }}>
          [{bucket.min}, {bucket.range === "strong_for" ? bucket.max : bucket.max})
        </span>
      </span>

      <span
        className="text-right font-mono-jb tabular-nums text-[0.625rem]"
        style={{ color: bucket.count > 0 ? "var(--text-secondary)" : "var(--text-muted)" }}
      >
        {bucket.count}
      </span>

      {/* Velocity bar */}
      <div className="relative h-4 flex items-center pl-2">
        {vel !== null && (
          <div
            className="h-2.5 rounded-sm"
            style={{
              width: `${Math.max(velBarWidth, 2)}%`,
              background: `color-mix(in srgb, ${velColor} 35%, transparent)`,
              border: `1px solid color-mix(in srgb, ${velColor} 55%, transparent)`,
            }}
          />
        )}
      </div>

      <span className="text-right font-mono-jb tabular-nums text-[0.625rem]" style={{ color: velColor }}>
        {vel !== null ? `${vel > 0 ? "+" : ""}${vel.toFixed(3)}` : "—"}
      </span>
    </div>
  );
}
