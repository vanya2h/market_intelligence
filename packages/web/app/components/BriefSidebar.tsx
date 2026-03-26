import { SentimentGauge } from "./SentimentGauge";
import { SectionBlock } from "./SectionBlock";
import { Tooltip } from "./Tooltip";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { regimeColor } from "../lib/regime-colors";

export const DIMENSION_TABS = ["DERIVATIVES", "ETFS", "SENTIMENT", "HTF"] as const;
export type DimensionTab = (typeof DIMENSION_TABS)[number];

export const TAB_LABELS: Record<DimensionTab, string> = {
  DERIVATIVES: "Derivatives",
  ETFS: "ETFs",
  SENTIMENT: "Sentiment",
  HTF: "HTF Structure",
};

const REGIME_DESCRIPTIONS: Record<string, Record<string, string>> = {
  DERIVATIVES: {
    CROWDED_LONG: "Persistently elevated funding + elevated OI + non-negative price trend. Longs are dominant and paying a premium; market is susceptible to a flush if sentiment shifts.",
    CROWDED_SHORT: "Persistently negative funding + elevated OI + non-positive price trend. Shorts are dominant; market is susceptible to a squeeze if price rallies.",
    HEATING_UP: "Mid-range funding with OI growing over the medium horizon. Positioning is building toward crowded but has not crossed the threshold yet.",
    NEUTRAL: "No dominant directional crowding detected. Funding is neutral and OI is not meaningfully elevated in either direction.",
    CAPITULATION: "Extreme liquidation event: liq percentile in the 90th+, paired with severe OI drop (≥10%) and significant price move (≥5%). Forced position unwind at scale.",
    UNWINDING: "Elevated liquidations driving a meaningful OI drop (≥5% in 24h). Active deleveraging with visible forced exits, but not yet at extreme scale.",
    DELEVERAGING: "Prolonged negative funding (3+ intervals) with gradual OI decline and no liquidation spike. Organic position reduction — slow bleed, not a flush.",
    NONE: "No active stress signal detected. Positioning may still be crowded, but there is no measurable event-driven pressure at this time.",
  },
  ETFS: {
    STRONG_INFLOW: "Sustained institutional buying via spot ETFs. Multi-day inflow streak signals strong conviction.",
    STRONG_OUTFLOW: "Sustained institutional selling via spot ETFs. Multi-day outflow streak signals cooling appetite.",
    REVERSAL_TO_INFLOW: "ETF flows have flipped from outflows to inflows. Early sign of renewed institutional demand.",
    REVERSAL_TO_OUTFLOW: "ETF flows have flipped from inflows to outflows. Early sign of institutional pullback.",
    NEUTRAL: "ETF flows are balanced with no clear directional trend.",
    MIXED: "Mixed ETF flow signals — no dominant pattern across funds.",
  },
  HTF: {
    MACRO_BULLISH: "Price above 200 DMA with bullish market structure (higher highs / higher lows).",
    BULL_EXTENDED: "Macro bullish but weekly RSI > 70 — overbought risk. Trend intact but momentum stretched.",
    MACRO_BEARISH: "Price below 200 DMA with bearish market structure (lower highs / lower lows).",
    BEAR_EXTENDED: "Macro bearish with weekly RSI < 30 — capitulation zone. Trend down but may be exhausted.",
    RECLAIMING: "Price between 50 DMA and 200 DMA, recovering. Potential trend reversal forming.",
    RANGING: "Mixed signals, no clear directional bias. Market is consolidating.",
  },
  SENTIMENT: {
    EXTREME_FEAR: "Composite sentiment deeply negative. Historically a contrarian buy signal.",
    FEAR: "Sentiment skews negative across inputs. Caution dominates but not at extremes.",
    NEUTRAL: "Balanced sentiment — no strong directional conviction from crowd or experts.",
    GREED: "Sentiment skews positive. Optimism rising but not yet at extremes.",
    EXTREME_GREED: "Composite sentiment deeply positive. Historically a contrarian sell signal.",
    CONSENSUS_BULLISH: "Expert analysts strongly agree on bullish outlook (z-score ≥ +0.8).",
    CONSENSUS_BEARISH: "Expert analysts strongly agree on bearish outlook (z-score ≤ −1.5).",
    SENTIMENT_DIVERGENCE: "Experts and crowd disagree — historically signals a turning point.",
  },
};

export interface BriefSidebarData {
  compositeIndex: number | null;
  compositeLabel: string | null;
  dimensions: { dimension: string; regime: string }[];
  positioning: number | null;
  trend: number | null;
  institutionalFlows: number | null;
  expertConsensus: number | null;
}

export function BriefSidebar({ brief }: { brief: BriefSidebarData }) {
  const { compositeIndex, compositeLabel, dimensions, positioning, trend, institutionalFlows, expertConsensus } = brief;
  return (
    <aside
      className="sticky top-19 hidden w-72 shrink-0 flex-col overflow-y-auto p-5 md:flex"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-card)",
        height: "calc(100vh - 4.75rem)",
      }}
    >
      {compositeIndex != null && compositeLabel && (
        <SectionBlock
          title="Composite Fear & Greed Index"
          className="mb-6"
          tooltip="Proprietary Fear & Greed index (0–100) built from four crypto-native inputs: derivatives positioning (30%), HTF trend (25%), analyst consensus (25%), ETF institutional flows (20%). Avoids Alternative.me's opaque methodology."
        >
          <SentimentGauge value={compositeIndex} label={compositeLabel} />
        </SectionBlock>
      )}

      <SectionBlock title="Regime Overview" className="mb-6">
        <div className="space-y-1">
          {DIMENSION_TABS.map((dim) => {
            const bd = dimensions.find((d) => d.dimension === dim);
            if (!bd) return null;
            const { color, arrow } = regimeColor(bd.regime);
            return (
              <div
                key={dim}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {TAB_LABELS[dim]}
                </span>
                <Tooltip content={REGIME_DESCRIPTIONS[dim]?.[bd.regime] ?? bd.regime} side="right">
                <span className="inline-flex cursor-default items-center gap-1 text-xs font-medium" style={{ color }}>
                  {bd.regime} {arrow}
                  <InfoCircledIcon width={11} height={11} style={{ color: "var(--text-muted)" }} />
                </span>
              </Tooltip>
              </div>
            );
          })}
        </div>
      </SectionBlock>

      <SectionBlock title="Overview">
        <div className="space-y-1">
          {[
            {
              label: "Positioning",
              value: positioning,
              tooltip: "Derivatives positioning score (0–100). Derived from funding rates, long/short ratio, and open interest percentiles. High = crowded longs / greed. Low = crowded shorts / fear.",
            },
            {
              label: "Trend",
              value: trend,
              tooltip: "HTF trend score (0–100). Derived from price vs 50/200 SMA, daily RSI, and market structure (HH/HL vs LH/LL). High = bullish macro structure.",
            },
            {
              label: "Inst. Flows",
              value: institutionalFlows,
              tooltip: "Institutional flows score (0–100). Derived from spot ETF daily net flows and streak length. Multi-day inflow streaks signal conviction. Outflows signal cooling appetite.",
            },
            {
              label: "Expert Cons.",
              value: expertConsensus,
              tooltip: "Expert consensus score (0–100). Derived from accuracy-weighted analyst consensus via unbias API. Z-score ≥ +0.8 = bullish conviction. Z-score ≤ −1.5 = bearish conviction.",
            },
          ].map(({ label, value, tooltip }) => {
            if (value == null) return null;
            const color = value < 30 ? "var(--red)" : value > 70 ? "var(--green)" : "var(--amber)";
            return (
              <div
                key={label}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <Tooltip content={tooltip} side="right">
                  <span className="inline-flex cursor-default items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {label}
                    <InfoCircledIcon width={11} height={11} />
                  </span>
                </Tooltip>
                <span className="font-mono-jb text-xs font-medium tabular-nums" style={{ color }}>
                  {Math.round(value)}
                </span>
              </div>
            );
          })}
        </div>
      </SectionBlock>
    </aside>
  );
}
