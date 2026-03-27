import { Link } from "react-router";
import { SentimentGauge } from "./SentimentGauge";
import { SectionBlock } from "./SectionBlock";
import { Tooltip } from "./Tooltip";
import { InfoCircledIcon, QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { regimeColor, regimeLabel } from "../lib/regime-colors";
import { RelativeTime } from "./RelativeTime";
import type { Brief } from "@market-intel/api";

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
    CROWDED_LONG:
      "Longs are dominant: elevated funding rates + high OI + positive price trend. Market is paying a premium to hold longs — susceptible to a flush if sentiment shifts. Contrarian bearish signal for swing traders.",
    CROWDED_SHORT:
      "Shorts are dominant: negative funding + elevated OI + negative price trend. Shorts are being paid to hold — susceptible to a squeeze if price rallies. Contrarian bullish signal.",
    HEATING_UP:
      "Positioning is building toward crowded but hasn't crossed the threshold. Funding mid-range with OI growing over the medium horizon. Watch for transition to CROWDED_LONG or CROWDED_SHORT.",
    POSITIONING_NEUTRAL:
      "No dominant directional crowding. Funding is neutral and OI is not meaningfully elevated. No contrarian edge from positioning — defer to other dimensions.",
    SHORT_SQUEEZE:
      "Rapid short covering event. Sharp price rally forcing shorts to close, driving further upside. Typically short-lived but can trigger trend acceleration.",
  },
  ETFS: {
    STRONG_INFLOW:
      "Sustained institutional buying via spot ETFs (3+ consecutive inflow days). Strong conviction from traditional finance — supports bullish swing bias.",
    STRONG_OUTFLOW:
      "Sustained institutional selling via spot ETFs (3+ consecutive outflow days). Institutional appetite is cooling — supports bearish swing bias.",
    REVERSAL_TO_INFLOW:
      "ETF flows flipped from outflows to inflows. Early sign of renewed institutional demand. Watch for follow-through to confirm STRONG_INFLOW.",
    REVERSAL_TO_OUTFLOW:
      "ETF flows flipped from inflows to outflows. Early sign of institutional pullback. Watch for follow-through to confirm STRONG_OUTFLOW.",
    ETF_NEUTRAL:
      "ETF flows are balanced with no clear directional trend. No institutional edge — rely on other dimensions for swing direction.",
    MIXED: "Mixed ETF flow signals — individual funds disagree on direction. No clear institutional consensus.",
  },
  HTF: {
    MACRO_BULLISH:
      "Price above 200 DMA with bullish market structure (higher highs, higher lows). Macro trend supports long swing entries on pullbacks.",
    BULL_EXTENDED:
      "Macro bullish but daily RSI > 70 — overbought. Trend is intact but momentum is stretched. Avoid chasing longs; wait for a pullback or divergence.",
    MACRO_BEARISH:
      "Price below 200 DMA with bearish structure (lower highs, lower lows). Macro trend supports short swing entries on rallies.",
    BEAR_EXTENDED:
      "Macro bearish with daily RSI < 30 — oversold / capitulation zone. Trend is down but may be exhausted. Watch for bullish divergence as reversal signal.",
    RECLAIMING:
      "Price between 50 DMA and 200 DMA, recovering from below. Potential trend reversal forming — a close above 200 DMA would confirm bullish transition.",
    RANGING:
      "No clear directional bias. Price oscillating without trend. Best suited for range-bound strategies or waiting for breakout confirmation.",
    ACCUMULATION:
      "Futures CVD rising while price consolidates — smart money is quietly building positions. Bullish undercurrent despite sideways price action.",
    DISTRIBUTION:
      "Futures CVD declining while price holds up — smart money is quietly exiting. Bearish undercurrent despite stable prices. Watch for breakdown.",
  },
  SENTIMENT: {
    EXTREME_FEAR:
      "Composite F&G below 20. The crowd is capitulating — historically a strong contrarian buy signal. Wait for a technical trigger before entering long.",
    FEAR: "Composite F&G 20–40. Sentiment skews negative. Risk/reward favors longs on pullbacks, but signal is not as strong as extreme fear.",
    SENTIMENT_NEUTRAL:
      "Composite F&G 40–60. Balanced sentiment — no actionable signal. Trade purely on technicals and structure.",
    GREED:
      "Composite F&G 60–80. Optimism rising. Tighten stops on longs, start scanning for short setups at resistance.",
    EXTREME_GREED:
      "Composite F&G above 80. The crowd is euphoric — historically a strong contrarian sell signal. Look for short entries or exit existing longs.",
    CONSENSUS_BULLISH:
      "Expert analysts are actively shifting bullish (consensus delta ≥ +10 pts/week) while composite is also greedy. Aligned bullish momentum across smart money and crowd.",
    CONSENSUS_BEARISH:
      "Expert analysts are actively shifting bearish (consensus delta ≤ -10 pts/week) while composite is also fearful. Aligned bearish momentum across smart money and crowd.",
    SENTIMENT_DIVERGENCE:
      "Experts and crowd disagree on direction. This is the highest-value signal — smart money diverging from crowd sentiment historically marks swing reversal points.",
  },
};

function stressColor(stress: string): string {
  if (stress === "CAPITULATION") return "var(--red)";
  if (stress === "UNWINDING") return "var(--red)";
  if (stress === "DELEVERAGING") return "var(--amber)";
  return "var(--text-muted)";
}

const STRESS_DESCRIPTIONS: Record<string, string> = {
  CAPITULATION:
    "Extreme liquidation cascade: liq percentile 90th+, OI dropped ≥10%, price moved ≥5%. Forced unwind at scale — often marks a local bottom. Watch for reversal setup once stress subsides.",
  UNWINDING:
    "Active deleveraging: elevated liquidations driving ≥5% OI drop in 24h. Forced exits are visible but not yet at capitulation scale. More downside possible before stabilization.",
  DELEVERAGING:
    "Slow organic position reduction: prolonged negative funding with gradual OI decline, no liquidation spike. A slow bleed rather than a flush — can persist for days.",
  STRESS_NONE: "No active stress signal detected.",
};

export function BriefSidebar({ brief }: { brief: Brief }) {
  const {
    compositeIndex,
    compositeLabel,
    dimensions,
    positioning,
    trend,
    institutionalFlows,
    expertConsensus,
    momentumDivergence,
    volatility,
  } = brief;
  return (
    <aside
      className="sticky top-10 hidden w-72 shrink-0 flex-col overflow-y-auto p-5 md:flex"
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-card)",
        height: "calc(100vh - 2.5rem)",
      }}
    >
      {compositeIndex != null && compositeLabel && (
        <SectionBlock
          title="Composite Fear & Greed Index"
          className="mb-6"
          tooltip="Proprietary Fear & Greed index (0–100) built from four crypto-native inputs: derivatives positioning (30%), HTF trend (25%), analyst consensus (25%), ETF institutional flows (20%). Avoids Alternative.me's opaque methodology."
        >
          <SentimentGauge value={compositeIndex} label={compositeLabel} />
          <Link
            to="/faq"
            className="mt-2 inline-flex items-center gap-1 text-[0.75rem] transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <QuestionMarkCircledIcon width={12} height={12} />
            How to read this index
          </Link>
        </SectionBlock>
      )}

      <SectionBlock title="Regime Overview" className="mb-6">
        <div className="space-y-1">
          {DIMENSION_TABS.map((dim) => {
            const bd = dimensions.find((d) => d.dimension === dim);
            if (!bd) return null;

            const { color, arrow } = regimeColor(bd.regime);
            const sinceDate = bd.since ? new Date(bd.since) : null;
            return (
              <div
                key={dim}
                className="flex flex-col gap-0.5 py-1.5"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {TAB_LABELS[dim]}
                  </span>
                  <Tooltip content={REGIME_DESCRIPTIONS[dim]?.[bd.regime] ?? bd.regime} side="right">
                    <span
                      className="inline-flex cursor-default items-center gap-1 text-xs font-medium"
                      style={{ color }}
                    >
                      <InfoCircledIcon style={{ color: "var(--text-muted)" }} />
                      {regimeLabel(bd.regime)} {arrow}
                    </span>
                  </Tooltip>
                </div>
                <div className="flex items-center justify-between">
                  {bd.previousRegime && bd.previousRegime !== bd.regime ? (
                    <span className="text-[0.625rem]" style={{ color: "var(--text-muted)" }}>
                      was {regimeLabel(bd.previousRegime!)}
                    </span>
                  ) : (
                    <span />
                  )}
                  {sinceDate && (
                    <span className="font-mono-jb text-[0.625rem] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      changed <RelativeTime date={sinceDate} />
                    </span>
                  )}
                </div>
                {dim === "DERIVATIVES" && bd.stress && bd.stress !== "STRESS_NONE" && (
                  <Tooltip content={STRESS_DESCRIPTIONS[bd.stress] ?? bd.stress} side="right">
                    <span
                      className="mt-0.5 inline-flex cursor-default items-center gap-1 self-start rounded px-1.5 py-0.5 text-[0.625rem] font-medium"
                      style={{ color: stressColor(bd.stress), background: "var(--bg-hover)" }}
                    >
                      STRESS: {bd.stress}
                      <InfoCircledIcon style={{ color: "var(--text-muted)" }} />
                    </span>
                  </Tooltip>
                )}
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
              tooltip:
                "Derivatives positioning score (0–100). Derived from funding rates, long/short ratio, and open interest percentiles. High = crowded longs / greed. Low = crowded shorts / fear.",
            },
            {
              label: "Trend",
              value: trend,
              tooltip:
                "HTF trend score (0–100). Derived from price vs 50/200 SMA, daily RSI, and market structure (HH/HL vs LH/LL). High = bullish macro structure.",
            },
            {
              label: "Inst. Flows",
              value: institutionalFlows,
              tooltip:
                "Institutional flows score (0–100). Derived from spot ETF daily net flows and streak length. Multi-day inflow streaks signal conviction. Outflows signal cooling appetite.",
            },
            // {
            //   label: "Expert Cons.",
            //   value: expertConsensus,
            //   tooltip:
            //     "Expert consensus score (0–100). Derived from accuracy-weighted analyst consensus via unbias API. Z-score ≥ +0.8 = bullish conviction. Z-score ≤ −1.5 = bearish conviction.",
            // },
            {
              label: "Momentum Div.",
              value: momentumDivergence,
              tooltip:
                "Momentum divergence score (0–100). Derived from price-RSI divergence and CVD divergence signals. High = bullish divergence building.",
            },
            {
              label: "Volatility",
              value: volatility,
              tooltip:
                "Volatility score (0–100). Derived from ATR compression/expansion relative to 30d mean. Low = compressed (breakout brewing). High = expanded (trend in motion).",
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
                  <span
                    className="inline-flex cursor-default items-center gap-1 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {label}
                    <InfoCircledIcon />
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
