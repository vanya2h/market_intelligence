import { Link } from "react-router";
import { AppHeader } from "../components/AppHeader";
import { StickyFooter } from "../components/StickyFooter";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-lg p-5 md:p-6"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <h2 className="mb-4 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ZoneBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-semibold font-mono-jb"
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
    >
      {label}
    </span>
  );
}

const zones = [
  {
    range: "0 – 25",
    label: "Extreme Fear",
    color: "var(--red)",
    bias: "Look for longs",
    description:
      "The crowd is capitulating — this is where swing lows form. Don't catch a falling knife: wait for a technical trigger (structure break, CVD divergence) before entering.",
  },
  {
    range: "25 – 40",
    label: "Fear",
    color: "#f07a32",
    bias: "Bullish bias",
    description:
      "Good zone to scale into longs on pullbacks. Risk/reward favors buyers because sentiment is already depressed.",
  },
  {
    range: "40 – 60",
    label: "Neutral",
    color: "var(--amber)",
    bias: "No sentiment edge",
    description:
      "No actionable signal from sentiment alone. Trade purely on technicals — price action, structure, and volume are your only guides here.",
  },
  {
    range: "60 – 75",
    label: "Greed",
    color: "#82d455",
    bias: "Bearish bias",
    description:
      "Tighten stops on existing longs, start scanning for short setups. Don't initiate new longs at resistance.",
  },
  {
    range: "75 – 100",
    label: "Extreme Greed",
    color: "var(--green)",
    bias: "Look for shorts",
    description:
      "The crowd is euphoric — this is where swing highs form. Look for short entries or exit longs. Strongest signal when combined with bearish divergence.",
  },
];

const components = [
  {
    name: "Positioning",
    weight: "40%",
    source: "Derivatives",
    description:
      "Funding rates, open interest, Coinbase premium, and bias-adjusted liquidations. Captures leverage buildup and directional crowding — the most reliable contrarian signal.",
  },
  {
    name: "Institutional Flows",
    weight: "30%",
    source: "ETF Flows",
    description:
      "Consecutive inflow/outflow streaks, flow magnitude relative to 30-day mean (sigma), and flow regime. Tracks real institutional money entering or leaving the market.",
  },
  {
    name: "Trend",
    weight: "15%",
    source: "HTF Technicals",
    description:
      "Price vs SMA-50/200, daily RSI, and market structure (HH/HL vs LH/LL). Captures the macro trend direction. Weight reduced because trend signals lag at reversal points.",
  },
  {
    name: "Momentum Divergence",
    weight: "10%",
    source: "HTF Technicals",
    description:
      "Detects when price and internal momentum disagree: price rising but RSI falling (distribution), or price falling but RSI rising (accumulation). CVD divergence amplifies the signal. Explicitly reversal-predictive.",
  },
  {
    name: "Volatility",
    weight: "5%",
    source: "HTF Technicals",
    description:
      "ATR compression/expansion ratio. Compressed volatility signals a coiled spring — a big move is building. Direction is inferred from price position relative to the 200 SMA.",
  },
  {
    name: "Expert Consensus",
    weight: "0%",
    source: "Unbias API",
    description:
      "Accuracy-weighted analyst consensus delta (week-over-week change). Currently disabled while collecting baseline data — will be re-enabled once we have sufficient delta history.",
  },
];

const keyPrinciples = [
  {
    title: "Extremes matter, the middle doesn't",
    content:
      "The index is most useful below 25 or above 75. A reading of 45 vs 55 should not change your trading plan. Think of it as a traffic light: red/green at extremes, yellow in between.",
  },
  {
    title: "It's contrarian, not directional",
    content:
      "High fear = look to buy. High greed = look to sell. The index measures crowd positioning, not where price is going. The crowd is a lagging indicator — by the time everyone is fearful, the selling is largely done.",
  },
  {
    title: "Component alignment amplifies signal",
    content:
      "When all components converge toward fear or greed simultaneously, the signal has real predictive power. When components are scattered (one fearful, one greedy, rest neutral), there's no edge.",
  },
  {
    title: "Divergence is the highest-value signal",
    content:
      "When expert consensus shifts bullish while the composite shows fear (or vice versa), it often marks the best swing entry. Smart money is front-running the crowd.",
  },
  {
    title: "Always require a technical trigger",
    content:
      'Sentiment sets the bias, price action provides the entry. An extreme fear reading says "look for longs" — not "buy now". Wait for a structure break, CVD divergence, or key level reclaim.',
  },
];

export default function Guide() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />

      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 md:p-6">
        {/* Intro */}
        <div>
          <h1 className="mb-2 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Fear & Greed Index — Swing Trader's Guide
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            The composite Fear & Greed index is a <strong>contrarian positioning filter</strong>, not a directional
            signal. It measures crowd sentiment across multiple dimensions to identify when the market is over-extended
            in either direction — these are the conditions where swing reversals are most likely.
          </p>
        </div>

        {/* Zones */}
        <Section title="Reading the zones">
          <div className="flex flex-col gap-3">
            {zones.map((z) => (
              <div
                key={z.range}
                className="flex flex-col gap-1.5 rounded-md p-3"
                style={{ background: "var(--bg-hover)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono-jb text-xs" style={{ color: "var(--text-muted)" }}>
                    {z.range}
                  </span>
                  <ZoneBadge color={z.color} label={z.label} />
                  <span className="ml-auto text-xs font-medium" style={{ color: z.color }}>
                    {z.bias}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {z.description}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Components */}
        <Section title="Components & weights">
          <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Each component scores 0–100 independently, then they're combined with the weights below into the final
            composite index.
          </p>
          <div className="flex flex-col gap-3">
            {components.map((c) => (
              <div
                key={c.name}
                className="flex flex-col gap-1 rounded-md p-3"
                style={{ background: "var(--bg-hover)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.source}
                    </span>
                    <span
                      className="font-mono-jb text-xs font-semibold rounded px-1.5 py-0.5"
                      style={{
                        color: c.weight === "0%" ? "var(--text-muted)" : "var(--text-primary)",
                        background: c.weight === "0%" ? "transparent" : "var(--bg-surface)",
                      }}
                    >
                      {c.weight}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {c.description}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Key principles */}
        <Section title="Key principles for swing trading">
          <div className="flex flex-col gap-3">
            {keyPrinciples.map((p, i) => (
              <div key={i} className="flex gap-3 rounded-md p-3" style={{ background: "var(--bg-hover)" }}>
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{
                    background: "var(--bg-surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {p.title}
                  </span>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {p.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </main>

      <StickyFooter />
    </div>
  );
}
