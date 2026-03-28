import { AppHeader } from "../components/AppHeader";
import { StickyFooter } from "../components/StickyFooter";

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

interface FaqItem {
  q: string;
  a: string | React.ReactNode;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const faqSections: { title: string; items: FaqItem[] }[] = [
  {
    title: "Understanding the metrics",
    items: [
      {
        q: "What is the Fear & Greed Index?",
        a: "A composite contrarian positioning filter scored 0–100. It measures crowd sentiment across multiple dimensions to identify when the market is over-extended in either direction — these are the conditions where swing reversals are most likely. It is not a directional signal: high fear means look to buy, high greed means look to sell.",
      },
      {
        q: "What do the different score zones mean?",
        a: "zones",
      },
      {
        q: "What components make up the composite score?",
        a: "Five active components, each scored 0–100 independently, combined with fixed weights: Positioning (37.5%) from derivatives data — funding rates, open interest, Coinbase premium, and bias-adjusted liquidations. Institutional Flows (20%) from ETF data — consecutive inflow/outflow streaks, flow magnitude relative to 30-day mean, and flow regime. Exchange Flows (17.5%) from on-chain data — coins moving on/off exchanges, reserve trends, and 30-day extremes. Trend (15%) from HTF technicals — price vs SMA-50/200, daily RSI, and market structure. Momentum Divergence (10%) from HTF technicals — price-RSI disagreement amplified by CVD divergence. Expert Consensus (0%) from the Unbias API — currently disabled while collecting baseline delta data. ATR volatility compression is not part of the composite score but is available to the LLM synthesizer as a contextual trade-setup signal.",
      },
      {
        q: "When is a reading of 45 vs 55 meaningful?",
        a: "It isn't. The index is most useful below 25 or above 75. Mid-range readings carry no actionable edge — trade purely on technicals when the index is neutral. Think of it as a traffic light: red/green at extremes, yellow in between.",
      },
      {
        q: "What does it mean when components disagree?",
        a: "When components are scattered (one fearful, one greedy, rest neutral), there's no sentiment edge. The signal has real predictive power only when multiple components converge toward fear or greed simultaneously. Confluence count matters: 4/4 dimensions agreeing is a much stronger signal than 1/4.",
      },
      {
        q: "What is the divergence signal?",
        a: "When expert consensus shifts bullish while the composite shows fear (or vice versa), it often marks the best swing entry. Smart money is front-running the crowd. This is the highest-value signal the system can produce.",
      },
      {
        q: "Should I trade directly from the index reading?",
        a: 'Never. Sentiment sets the bias, price action provides the entry. An extreme fear reading says "look for longs" — not "buy now." Always wait for a technical trigger: a structure break, CVD divergence, or key level reclaim.',
      },
    ],
  },
  {
    title: "How metrics are calculated",
    items: [
      {
        q: "Where does the data come from?",
        a: "Four sources. CoinGlass API provides derivatives data (funding rates at 8-hour resolution over 30 days, open interest at 4-hour resolution over 30 days, liquidation volumes at 8-hour resolution over 90 days, Coinbase premium), ETF flow data (daily net flows, GBTC premium), and exchange balance data (historical balances per exchange with 1d/7d/30d changes). Binance Spot provides 4H and daily OHLCV candles (300 4H, 104 daily) for technical indicators. Binance Futures provides 4H candles for CVD analysis. The Unbias API provides accuracy-weighted analyst consensus (currently collecting baseline data).",
      },
      {
        q: "How is the Positioning score calculated?",
        a: "Each raw metric (funding, OI, liquidations) is ranked into percentiles over 1-week, 1-month, and 3-month windows. Two independent classifiers run on this data. The Positioning classifier (slow, structural) detects crowded longs/shorts: funding percentile above 80 with elevated OI triggers CROWDED_LONG, below 20 triggers CROWDED_SHORT. The Stress classifier (fast, event-driven) detects capitulation (liquidations above 85th percentile with OI drop and price move), unwinding (moderate OI decline with elevated liquidations), and deleveraging (consecutive negative funding with gradual OI decline). Both use hysteresis thresholds to prevent rapid state flipping.",
      },
      {
        q: "How is the Institutional Flows score calculated?",
        a: "The classifier tracks consecutive inflow/outflow streaks — 3+ days of the same direction triggers a strong signal. Flow magnitude is measured as sigma (standard deviations from the 30-day mean) to catch outsized days. Reversal detection fires when 2+ days of opposite flow appear after a streak, with magnitude at least 20% of the prior phase. States: STRONG_INFLOW, STRONG_OUTFLOW, REVERSAL_TO_INFLOW, REVERSAL_TO_OUTFLOW, and MIXED.",
      },
      {
        q: "How is the Exchange Flows score calculated?",
        a: "Exchange flows track coins moving on and off exchanges across 20+ exchanges. Coins leaving exchanges (outflow) signal accumulation — investors moving to self-custody with no intent to sell. Coins entering exchanges (inflow) signal distribution — positioning to sell. The score maps 7-day reserve change to a 0–100 scale (outflow = bullish/high, inflow = bearish/low), boosted by trend confirmation (falling reserves = bullish), 30-day extremes (reserves at 30d low = strong accumulation), and regime state. States: ACCUMULATION, DISTRIBUTION, EF_NEUTRAL, HEAVY_INFLOW, HEAVY_OUTFLOW.",
      },
      {
        q: "How are the technical indicators computed?",
        a: "SMA-50 and SMA-200 on 4H candles (300 candle history). RSI-14 on daily candles (104 candle history) plus 4H for momentum. CVD uses dual-window analysis (20-candle short, 75-candle long) with slope and R² thresholds. Market structure is detected via pivot analysis (higher-highs/higher-lows vs lower-highs/lower-lows). VWAP is anchored weekly and monthly. ATR-14 on 4H candles measures volatility.",
      },
      {
        q: "How does the Momentum Divergence detection work?",
        a: "It detects when price direction and internal momentum disagree: price making new highs while RSI makes lower highs (bearish divergence / distribution), or price making new lows while RSI makes higher lows (bullish divergence / accumulation). CVD from Binance Futures amplifies the signal — if volume flow contradicts the price trend, the divergence is stronger. This component is explicitly reversal-predictive.",
      },
      {
        q: "What does 'code computes, LLMs reason' mean?",
        a: "All metrics are computed deterministically by code: percentiles, state machines, technical indicators. No LLM is involved in scoring. LLM agents (Claude Sonnet) then interpret the computed metrics — they receive the regime states and context, and produce the written brief explaining what it means. The separation ensures scores are reproducible and auditable, while interpretation benefits from language model reasoning.",
      },
    ],
  },
  {
    title: "Trade ideas",
    items: [
      {
        q: "How are trade ideas generated?",
        a: "Fully mechanical — no LLM involved in the decision. The system scores all three directions (LONG, SHORT, FLAT) using granular confluence scoring across five dimensions. Each dimension produces a conviction score from -100 to +100. The direction with the highest total is selected. If no direction passes the conviction threshold (200 out of a possible 500), the idea is marked as 'skipped' but still tracked for accuracy measurement.",
      },
      {
        q: "What are the five confluence dimensions?",
        a: "Derivatives (positioning crowding, stress events, funding pressure, OI context), ETF Flows (flow sigma with regime-contradiction bonus, streak exhaustion, reversal ratio), HTF Structure (RSI confidence, CVD divergence, volatility compression, regime, market structure), Sentiment (contrarian composite F&G, component convergence, regime), and Exchange Flows (on-chain reserve changes, balance trend, flow sigma, 30-day extremes). Each scores -100 to +100 independently.",
      },
      {
        q: "What is the conviction threshold and why 200?",
        a: "The total conviction ranges from -500 to +500 (five dimensions). A directional trade is only 'taken' when total >= 200 — meaning at least two dimensions need to strongly agree, or several need to moderately agree. This filters out low-conviction noise. Ideas below 200 are still saved and tracked as 'skipped' so we can measure whether the threshold is too strict (missing good trades) or too loose (taking bad ones).",
      },
      {
        q: "What happens when a trade idea is skipped?",
        a: "Skipped ideas are tracked with the same returns curve and level resolution as taken ideas. The UI shows a 'missed move' indicator that measures how wrong the skip was, using the same time-decay quality formula (returnPct × e^(-t/72)). A fast move in the predicted direction scores high (significant miss), while a slow move scores low (negligible). This directly calibrates the conviction threshold.",
      },
      {
        q: "What is the volatility compression (coiled spring) signal?",
        a: "After a big price move, volatility tends to decay — ATR drops as the market consolidates. This 'coiled spring' often precedes the next explosive move. The system detects it by comparing current ATR to its recent 50-candle distribution: when ATR is in the bottom 30th percentile AND a recent displacement of 2+ ATR units exists within the last 30 candles, the compression flag fires. This doesn't pick direction — it amplifies conviction in whichever direction other signals (RSI, CVD) point. The idea: catch the moment the market transitions from turbulence decay into the next big move.",
      },
      {
        q: "How are price targets computed?",
        a: "A weighted median of four mean-reversion structure levels: SMA-50 (30%), SMA-200 (25%), weekly VWAP (25%), monthly VWAP (15%). RSI confidence scales the target distance — when RSI is extreme (near 0 or 100), the target stands at full distance; when RSI is near 50, it compresses toward entry (0.3x floor). Each idea produces seven tracked levels: four invalidation stops at R:R 1:2 through 1:5, and three targets at 50%, 100%, and 150% of target distance.",
      },
      {
        q: "What role does the LLM play in trade ideas?",
        a: "None in the decision itself. Direction, targets, levels, and confluence scoring are all computed mechanically by code. The LLM receives the mechanical decision and writes a human-readable brief describing it — explaining what's driving conviction or why a trade was skipped. The LLM cannot override the direction or suggest alternatives.",
      },
      {
        q: "What timeframe does the analysis use?",
        a: "4-hour candles are the primary execution timeframe: SMA-50/200, RSI-14 (entry), CVD dual-window analysis, ATR-14, VWAP anchoring, and volatility compression are all computed on 4H bars (~300 candle history). Daily candles provide structural context: RSI-14 (trend bias) and ATR-filtered pivot detection for market structure (~104 candle history). This matches the swing trading horizon — 4H is granular enough for precise entries while daily filters noise from structural reads. The outcome checker also tracks on 4H candles.",
      },
    ],
  },
  {
    title: "Swing trading optimization",
    items: [
      {
        q: "Why is this system optimized for swing trading specifically?",
        a: "Every design decision — from weight allocation to quality scoring — is tuned for multi-day to multi-week reversal setups. Positioning gets 37.5% weight because leveraged crowding is the most reliable contrarian signal for swing reversals. Institutional and exchange flows together get 37.5% because capital flow direction (both on-chain and via ETFs) is a strong leading indicator. Trend only gets 15% because trend-following signals lag at reversal points. The time-decay quality scoring penalizes signals that take weeks to play out. This isn't useful for day trading (too slow) or long-term investing (too tactical).",
      },
      {
        q: "Why does Positioning get 37.5% while Trend only gets 15%?",
        a: "When everyone is on one side of the trade, the reversal is violent — that's the swing entry. Trend-following signals are accurate in the middle of a move but lag at exactly the reversal points where swing entries happen. This weighting is deliberately anti-consensus: most systems overweight trend. Exchange Flows (17.5%) captures on-chain supply pressure — a distinct signal from ETF-based institutional flows. Momentum Divergence (10%) is added specifically because it's reversal-predictive.",
      },
      {
        q: "What is the two-dimensional derivatives model?",
        a: "The system separates 'who is crowded' (Positioning: slow, structural) from 'what is happening to them' (Stress: fast, event-driven). CROWDED_LONG + CAPITULATION is a very different setup from CROWDED_LONG + no stress — the first is a potential swing low, the second is an ongoing trend that could continue. Collapsing these into a single state would lose critical timing information.",
      },
      {
        q: "What is hysteresis and why does it matter?",
        a: "All classifiers use different thresholds for entering vs exiting a state. CROWDED_LONG triggers at funding percentile above 80 but only exits at below 75. This prevents 'flickering' — rapid state changes right at the boundary that would generate false signals. For swing trading, you need regime readings stable enough to act on over multi-day timeframes.",
      },
      {
        q: "How does confluence scoring and the conviction gate work?",
        a: "Each of five dimensions (Derivatives, ETFs, HTF, Sentiment, Exchange Flows) produces a conviction score from -100 to +100 relative to the trade direction — not a simple agree/disagree, but a granular measure of how strongly each dimension supports the trade. The total conviction ranges from -500 to +500. A directional trade is only taken when total >= 200 — this keeps you out of low-conviction noise and ensures multiple independent data sources agree before risking capital. See the Trade Ideas section above for full details on each dimension's scoring.",
      },
    ],
  },
  {
    title: "Results measurement & evolution",
    items: [
      {
        q: "How are trade ideas tracked?",
        a: "Each idea generates seven independently-tracked price levels: four invalidation stops (at 1:2, 1:3, 1:4, and 1:5 risk-reward ratios) and three targets (T1 at 50% of target distance, T2 at 100%, T3 at 150% extension). The composite target is a weighted median of mean-reversion levels: SMA-50 (30%), SMA-200 (25%), weekly VWAP (25%), and monthly VWAP (15%), compressed by an RSI confidence multiplier. Each level resolves independently when price touches it.",
      },
      {
        q: "How does automated outcome checking work?",
        a: "A cron job runs twice daily (06:00 and 18:00 UTC), fetching 4H candles from Binance since the last check. For each open trade idea, it records the returns curve (hours elapsed, price, return %, quality score at that point) and resolves levels when price hits them. Targets resolve as WIN when the candle high/low reaches the level. Invalidations resolve as LOSS when breached. Any level unresolved after 30 days is marked LOSS with quality = 0.",
      },
      {
        q: "What is the quality score and why does it decay?",
        a: "quality = return × e^(−hours / 72). A target hit in 4 hours retains 95% quality. After 1 day: 72%. After 3 days: 37%. After 7 days: 10%. This encodes the belief that a good swing signal should resolve within days — a 'technically correct' call that takes two weeks was probably luck, not signal. Both wins and losses that take a long time score low, because a weak signal in either direction isn't useful.",
      },
      {
        q: "How does the system know which metrics are actually predictive?",
        a: "Once enough trade ideas accumulate (target: 50+), outcomes are sliced by which dimensions agreed at creation time. If ideas where Derivatives agreed have a 65% win rate but ideas where ETFs agreed only have 48%, that's actionable — future weight rebalancing should favor Derivatives even more. Performance is also bucketed by the HTF regime at creation (MACRO_BULLISH, RANGING, etc.) to catch models that only work in certain conditions.",
      },
      {
        q: "How does the system detect when it's degrading?",
        a: "Quality scores are tracked as a time series. A sustained downtrend in average quality signals model degradation — the market regime has shifted in a way the current weights and thresholds don't capture. This is the trigger to recalibrate: adjust weights, retune percentile thresholds, or integrate a new data dimension from the planned but not yet active sources.",
      },
      {
        q: "Will the system change over time?",
        a: "Yes, by design. The current weights and thresholds are a starting hypothesis. As outcome data accumulates, the system recalibrates based on what's actually predictive — not what seemed like it should be. Exchange Flows was recently added as the fifth dimension, capturing on-chain supply pressure that ETF flows alone don't cover. Additional data dimensions (options/IV, macro indicators, prediction markets, stablecoin flows) are planned and will be integrated as they prove additive to signal quality. Expert Consensus is included in the architecture but disabled at 0% weight until enough delta data exists to calibrate it properly.",
      },
    ],
  },
];

function FaqEntry({ q, a }: FaqItem) {
  return (
    <details className="group rounded-md" style={{ background: "var(--bg-hover)" }}>
      <summary
        className="flex cursor-pointer select-none items-center gap-2 p-3 text-sm font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center text-[0.625rem] transition-transform group-open:rotate-90"
          style={{ color: "var(--text-muted)" }}
        >
          ▶
        </span>
        {q}
      </summary>
      <div className="px-3 pb-3 pl-9">
        {a === "zones" ? (
          <div className="flex flex-col gap-2">
            {zones.map((z) => (
              <div
                key={z.range}
                className="flex flex-col gap-1 rounded p-2"
                style={{ background: "var(--bg-surface)" }}
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
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {a}
          </p>
        )}
      </div>
    </details>
  );
}

export default function Guide() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />

      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            FAQ
          </h1>
          <p className="leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            How this system works, what the metrics mean, and how it evolves.
          </p>
        </div>

        {faqSections.map((section) => (
          <section key={section.title} id={slugify(section.title)}>
            <h2 className="mb-4 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {section.title}
            </h2>
            <div className="flex flex-col gap-2">
              {section.items.map((item) => (
                <FaqEntry key={item.q} {...item} />
              ))}
            </div>
          </section>
        ))}
      </main>

      <StickyFooter />
    </div>
  );
}
