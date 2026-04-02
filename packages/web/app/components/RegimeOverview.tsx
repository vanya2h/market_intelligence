import { InfoCircledIcon } from "@radix-ui/react-icons";
import type { Brief } from "@market-intel/api";
import { regimeColor, regimeLabel } from "../lib/regime-colors";
import { Tooltip } from "./Tooltip";
import { DIMENSION_LABELS, DIMENSIONS } from "../lib/dimensions";

export const REGIME_DESCRIPTIONS: Record<string, Record<string, string>> = {
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
  EXCHANGE_FLOWS: {
    ACCUMULATION:
      "Coins flowing off exchanges — investors withdrawing to self-custody. Less supply available for selling, reducing sell pressure. Bullish signal for swing traders.",
    DISTRIBUTION:
      "Coins flowing onto exchanges — investors depositing to sell. More supply available for selling, increasing sell pressure. Bearish signal for swing traders.",
    EF_NEUTRAL:
      "No clear directional trend in exchange flows. Reserve levels are stable. No edge from on-chain flows — defer to other dimensions.",
    HEAVY_INFLOW:
      "Extreme single-day inflow to exchanges (>2σ from 30d mean). Large amount of coins deposited — potential imminent sell pressure. Watch for follow-through.",
    HEAVY_OUTFLOW:
      "Extreme single-day outflow from exchanges (>2σ from 30d mean). Large withdrawal to self-custody — strong accumulation signal. Bullish.",
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

export function RegimeOverview({ brief }: { brief: Brief }) {
  return (
    <div className="space-y-0.5">
      {brief.compositeIndex != null &&
        brief.compositeLabel &&
        (() => {
          const idx = brief.compositeIndex!;
          const fgColor = idx <= 40 ? "var(--red)" : idx <= 60 ? "var(--amber)" : "var(--green)";
          return (
            <div
              className="flex items-center justify-between py-1.5"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <Tooltip
                content="Composite Fear & Greed (0–100): derivatives positioning (50%), institutional flows (30%), HTF trend (20%). Context metric — not used in confluence scoring."
                side="right"
              >
                <span
                  className="inline-flex cursor-default items-center gap-1 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Fear & Greed
                  <InfoCircledIcon style={{ color: "var(--text-muted)" }} />
                </span>
              </Tooltip>
              <span className="text-xs font-medium font-mono-jb tabular-nums" style={{ color: fgColor }}>
                {Math.round(idx)} — {brief.compositeLabel}
              </span>
            </div>
          );
        })()}
      {DIMENSIONS.map((dim) => {
        const bd = brief.dimensions.find((d) => d.dimension === dim);
        if (!bd) return null;
        const { color, arrow } = regimeColor(bd.regime);
        return (
          <div
            key={dim}
            className="flex flex-col gap-0.5 py-1.5"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {DIMENSION_LABELS[dim]}
              </span>
              <Tooltip content={REGIME_DESCRIPTIONS[dim]?.[bd.regime] ?? bd.regime} side="right">
                <span className="inline-flex cursor-default items-center gap-1 text-xs font-medium" style={{ color }}>
                  <InfoCircledIcon style={{ color: "var(--text-muted)" }} />
                  {regimeLabel(bd.regime)} {arrow}
                </span>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}
