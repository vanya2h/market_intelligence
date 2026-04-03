import { AppHeader } from "../components/AppHeader";
import { Collapsible } from "../components/Collapsible";
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

const opportunityZones = [
  {
    range: "+70 to +100",
    label: "Strong Buy",
    color: "var(--green)",
    bias: "High conviction long",
    description:
      "Multiple dimensions strongly agree on a buy setup. Derivatives crowding, institutional flows, HTF structure, and exchange flows all pointing the same way. This is where the system takes directional trades.",
  },
  {
    range: "+40 to +70",
    label: "Moderate Buy",
    color: "var(--amber)",
    bias: "Bullish lean",
    description:
      "Directional lean toward buying, but not all dimensions agree. Some components support, others are neutral. Conviction may be insufficient for a trade — check the confluence breakdown for what's missing.",
  },
  {
    range: "-15 to +40",
    label: "No Edge",
    color: "var(--text-muted)",
    bias: "Wait",
    description:
      "Dimensions are balanced or all weak. No actionable directional signal. The system will skip trade ideas in this zone. Wait for dimensions to converge.",
  },
  {
    range: "-70 to -15",
    label: "Moderate Sell",
    color: "var(--amber)",
    bias: "Bearish lean",
    description:
      "Directional lean toward selling. Some dimensions agree on a short setup but conviction may be below threshold. Tighten stops on longs, start scanning for short entries.",
  },
  {
    range: "-100 to -70",
    label: "Strong Sell",
    color: "var(--red)",
    bias: "High conviction short",
    description:
      "Multiple dimensions strongly agree on a sell setup. The mirror of Strong Buy — the system sees a high-probability reversal to the downside.",
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
        q: "What is the Opportunity Score?",
        a: "A bipolar directional edge score from -100 to +100. It answers the single question: \"should I buy or sell right now?\" Positive = buy setup, negative = sell setup, near zero = no edge. The score is derived from the directional bias between LONG and SHORT confluence — the gap between how strongly the market supports buying vs selling, normalized to a clean scale. The sign IS the direction, the magnitude IS the conviction.",
      },
      {
        q: "What do the different score zones mean?",
        a: "opportunityZones",
      },
      {
        q: "What is the Composite Fear & Greed Index?",
        a: "A secondary context metric scored 0–100 that measures crowd sentiment. It is not the primary metric — the Opportunity Score is. The F&G index uses three components: Positioning (50%) from derivatives data, Institutional Flows (30%) from ETF data, and Trend (20%) from HTF technicals. It is useful as crowd temperature context for the LLM synthesizer but does not contribute to the mechanical confluence scoring — doing so would triple-count signals already measured by the source dimensions.",
      },
      {
        q: "What are the four confluence dimensions?",
        a: "Four independent dimensions each score -100 to +100 for a given direction. HTF Structure: volatility compression, CVD divergence, RSI stretch, volume profile displacement, and MA mean-reversion pull. Derivatives: crowded longs/shorts, stress events (capitulation/unwinding), funding extremes, and open interest fuel. ETF Flows: flow sigma with regime-contradiction bonus, reversal confirmation after streaks, reversal ratio, and reversal regime. Exchange Flows: 7d/30d reserve changes and 30-day reserve extremes. Sentiment was removed from confluence scoring — it is a composite of derivatives (50%) + ETFs (30%) + HTF (20%), so including it would triple-count those dimensions.",
      },
      {
        q: "What does it mean when dimensions disagree?",
        a: "When dimensions are split (some positive, some negative), the Opportunity Score will be near zero — no edge. The signal has real predictive power only when multiple dimensions converge in the same direction. Check the confluence breakdown rows to see which dimensions agree and which oppose.",
      },
      {
        q: "Should I trade directly from the Opportunity Score?",
        a: 'The Opportunity Score tells you the mechanical system\'s assessment. A strong reading (+70 or -70) means multiple independent data sources agree on direction. However, the system is designed for swing trading reversals — always consider the broader context and your own risk management. The trade idea section shows the full confluence breakdown, entry/target levels, and whether a trade was actually taken.',
      },
    ],
  },
  {
    title: "How metrics are calculated",
    items: [
      {
        q: "Where does the data come from?",
        a: "Four sources. CoinGlass API provides derivatives data (funding rate OI-weighted across Binance, OKX, Bybit, dYdX, and Hyperliquid; 30-day funding history at 8-hour resolution via Binance; open interest at 4-hour resolution over 30 days; liquidation volumes at 8-hour resolution over 90 days; Coinbase premium), ETF flow data (daily net flows, GBTC premium), and exchange balance data (historical balances per exchange with 1d/7d/30d changes). Binance Spot provides 4H and daily OHLCV candles (300 4H, 104 daily) for technical indicators. Binance Futures provides 4H candles for CVD analysis. The Unbias API provides accuracy-weighted analyst consensus (currently collecting baseline data).",
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
        a: "Exchange flows track coins moving on and off exchanges across 20+ exchanges. Coins leaving exchanges (outflow) signal accumulation — investors moving to self-custody with no intent to sell. Coins entering exchanges (inflow) signal distribution — positioning to sell. The score maps 7-day reserve change to a 0–100 scale (outflow = bullish/high, inflow = bearish/low), boosted by trend confirmation (falling reserves = bullish), 30-day extremes (reserves at 30d low = strong accumulation), and regime state. States: ACCUMULATION, DISTRIBUTION, EF_NEUTRAL, HEAVY_INFLOW, HEAVY_OUTFLOW. Note: Exchange Flows was removed from the sentiment composite (proved unreliable as a sentiment signal) but remains a standalone dimension and contributes to trade idea confluence scoring.",
      },
      {
        q: "How are the technical indicators computed?",
        a: "SMA-50 and SMA-200 on 4H candles (300 candle history). RSI-14 on daily candles (104 candle history) plus 4H for momentum. CVD uses dual-window analysis (20-candle short, 75-candle long) with pivot-based divergence detection — see the CVD question below. Market structure is detected via pivot analysis (higher-highs/higher-lows vs lower-highs/lower-lows). VWAP is anchored weekly and monthly. ATR-14 on 4H candles measures volatility. Volume Profile is computed from futures 4H candles (750 candle history, ~4 months) with displacement-based range detection — see the Volume Profile section below.",
      },
      {
        q: "How does CVD divergence detection work?",
        a: "CVD (Cumulative Volume Delta) measures the difference between aggressive buying and selling: buy volume hits the ask, sell volume hits the bid. The system compares swing highs/lows of price vs CVD to detect two distinct mechanisms. Absorption: CVD makes a new extreme but price does not — the opposing side is actively absorbing aggression (e.g. CVD higher high while price stalls = buyers being absorbed by large limit sellers). This is the stronger signal because heavy hands are actively working. Exhaustion: price makes a new extreme but CVD does not — aggression is simply disappearing (e.g. price higher high while CVD stalls = buyers are gone, move running on thin liquidity). Both are divergences, but absorption implies active distribution/accumulation while exhaustion implies the trend is running out of fuel. The system also compares spot CVD vs futures CVD: if futures CVD rises during a bounce while spot CVD stays flat or falls, the bounce is classified as a suspect bounce driven by short covering with no real demand behind it.",
      },
      {
        q: "How does the Momentum Divergence detection work?",
        a: "It detects when price direction and internal momentum disagree: price making new highs while RSI makes lower highs (bearish divergence / distribution), or price making new lows while RSI makes higher lows (bullish divergence / accumulation). CVD from Binance Futures amplifies the signal — if volume flow contradicts the price trend, the divergence is stronger. Note: this was removed from the sentiment composite score (proved unreliable as a sentiment signal) but the detection is still computed and available to the LLM synthesizer and trade idea confluence scoring.",
      },
      {
        q: "What does 'code computes, LLMs reason' mean?",
        a: "All metrics are computed deterministically by code: percentiles, state machines, technical indicators. No LLM is involved in scoring. LLM agents (Claude Sonnet) then interpret the computed metrics — they receive the regime states and context, and produce the written brief explaining what it means. The separation ensures scores are reproducible and auditable, while interpretation benefits from language model reasoning.",
      },
    ],
  },
  {
    title: "Volume Profile",
    items: [
      {
        q: "What is Volume Profile?",
        a: "Volume Profile shows how much trading volume occurred at each price level over a period. Unlike time-based volume bars, it reveals where the market spent the most time transacting — these high-volume levels act as price magnets. The system computes it from Binance futures 4H candles (~4 months of history) by distributing each candle's volume uniformly across the price bins it spans.",
      },
      {
        q: "What is the POC (Point of Control)?",
        a: "The price level with the highest traded volume — the strongest single price magnet. Price tends to gravitate toward the POC during range-bound conditions. In the composite target calculation, the POC carries the highest weight (25%) because it represents empirical consensus on fair value.",
      },
      {
        q: "What is the Value Area (VA)?",
        a: "The price range containing 70% of all traded volume, built by expanding outward from the POC. VA High and VA Low define the boundaries. When price is inside the VA, it's trading within fair value. When outside, it's extended and more likely to mean-revert. The system reports your position as ABOVE VA, INSIDE VA, or BELOW VA.",
      },
      {
        q: "How does displacement-based range detection work?",
        a: "Volume Profile is most meaningful during ranges — not trends. The system automatically detects where the current range started by walking backward through candles looking for a displacement: a single candle moving more than 5×ATR, or a 3-candle window moving more than 5×ATR. The profile is anchored to the first candle after that displacement. This ensures the profile only includes volume from the current trading range, not from a prior trend phase. Minimum range: 20 candles (~3.3 days). If no displacement is found in the full 750-candle window, all candles are used.",
      },
      {
        q: "What are HVNs and LVNs?",
        a: "High Volume Nodes (HVNs) are secondary price magnets — bins with significant volume concentration, excluding the POC. Price tends to consolidate around HVNs. Low Volume Nodes (LVNs) are acceleration zones — thin areas between HVNs where price moves quickly because there's little historical agreement. LVNs often act as support/resistance gaps: price either bounces off them or rips through.",
      },
      {
        q: "How does Volume Profile affect trade ideas?",
        a: "Two ways. First, the POC is the highest-weighted level (25%) in the composite target calculation — it pulls the target toward the strongest volume magnet. Second, price position relative to the Value Area contributes 15% of the HTF confluence score: price below the VA is a bullish signal (POC magnet pulls up), price above is bearish. The signal strength scales with POC thickness — a concentrated POC with 5%+ of total volume gets full weight.",
      },
    ],
  },
  {
    title: "Liquidity Sweep Levels",
    items: [
      {
        q: "What are liquidity sweep levels?",
        a: "Stale weekly and monthly highs and lows that accumulate stop orders over time. Traders place stops above highs and below lows — the longer a level sits untested, the more orders cluster around it. Market makers and large players are incentivized to push price through these levels to trigger the accumulated orders, creating a 'sweep.' The system tracks these levels as directional price magnets.",
      },
      {
        q: "How is sweep attraction calculated?",
        a: "Sweep attraction = log2(age in days) / (distance % + 0.5) × 100. Closer and older levels score highest — a nearby level with weeks of accumulated stops is the most likely to be swept. Age uses log2 for diminishing returns (a 30-day-old level is much more attractive than a 7-day one, but 90-day vs 60-day matters less). Distance is in the denominator: levels close to current price score higher because they're easier to reach. Levels less than 3 days old are ignored (too fresh to accumulate meaningful liquidity).",
      },
      {
        q: "How do sweep levels affect trade ideas?",
        a: "The highest-attraction sweep level in the trade direction gets 10% weight in the composite target — for a LONG idea, the nearest unswept high above price pulls the target up; for SHORT, the nearest unswept low below pulls it down. Sweep proximity was removed from the HTF confluence score (±15 noise that didn't improve reversal detection) but the levels remain valuable as directional price targets.",
      },
      {
        q: "What timeframes are tracked?",
        a: "Current calendar month and current calendar week highs and lows, computed from daily candles. When a new month starts on the 1st, the counter resets and new highs/lows begin forming. Same for weeks on Monday. Only the actively forming period is tracked — previous months/weeks are discarded. Near-duplicate levels (weekly and monthly within 0.5% of each other) are deduplicated, keeping the one with higher attraction.",
      },
    ],
  },
  {
    title: "Trade ideas",
    items: [
      {
        q: "How are trade ideas generated?",
        a: "Fully mechanical — no LLM involved in the decision. The system scores all three directions (LONG, SHORT, FLAT) using granular confluence scoring across four dimensions. Each dimension produces a conviction score from -100 to +100. The direction with the highest total is selected. If no direction passes the conviction threshold (200 out of a possible 400), the idea is marked as 'skipped' but still tracked for accuracy measurement.",
      },
      {
        q: "What are the four confluence dimensions?",
        a: "Derivatives (crowded longs/shorts, stress events like capitulation/unwinding, funding extremes, OI fuel), ETF Flows (flow sigma with regime-contradiction bonus, reversal confirmation, reversal ratio, reversal regime), HTF Structure (volatility compression, CVD divergence, RSI stretch, volume profile displacement, MA mean-reversion pull), and Exchange Flows (7d/30d reserve changes, 30-day reserve extremes). Each scores -100 to +100 independently. Sentiment was removed — it is a composite of the other dimensions, so including it would triple-count signals.",
      },
      {
        q: "What is the conviction threshold and why 200?",
        a: "The total conviction ranges from -400 to +400 (four dimensions). A directional trade is only 'taken' when total >= 200 — meaning at least two dimensions need to strongly agree, or several need to moderately agree. This filters out low-conviction noise. Ideas below 200 are still saved and tracked as 'skipped' so we can measure whether the threshold is too strict (missing good trades) or too loose (taking bad ones). For volatility compression setups, the threshold is dynamically lowered (down to 120) since the coiled spring setup compensates for ambiguity in weaker dimensions.",
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
        a: "A weighted median of up to six mean-reversion and directional levels: POC (25%), SMA-200 (20%), SMA-50 (15%), weekly VWAP (15%), monthly VWAP (15%), and the directional sweep level (10%). The POC from the volume profile is the highest-weighted level — the strongest empirical price magnet. The sweep level is directional: for LONG ideas, the highest-attraction unswept high above price; for SHORT, the highest-attraction unswept low below. RSI confidence scales the target distance — when RSI is extreme (near 0 or 100), the target stands at full distance; when RSI is near 50, it compresses toward entry (0.3x floor). Each idea produces seven tracked levels: four invalidation stops at R:R 1:2 through 1:5, and three targets at 50%, 100%, and 150% of target distance.",
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
        a: "Every design decision — from signal selection to quality scoring — is tuned for multi-day to multi-week reversal setups. The confluence scoring was audited specifically for reversal detection: signals that fire mid-trend or during compression (HEATING_UP, streak exhaustion, market structure) were removed because they add noise at reversal points. What remains are signals that confirm the crowd is positioned wrong and a spring is loaded. The time-decay quality scoring penalizes signals that take weeks to play out. This isn't useful for day trading (too slow) or long-term investing (too tactical).",
      },
      {
        q: "How are the confluence weights prioritized?",
        a: "HTF Structure leads (compression 30%, CVD 25%, RSI 20%, VP 15%, MA displacement 10%) because the coiled spring + divergence combination is the core reversal setup. Derivatives are weighted toward crowded positioning and capitulation/unwinding stress — not heating or deleveraging which are noise. ETFs prioritize flow sigma with regime contradiction and reversal confirmation over streak exhaustion which fires too early. Exchange Flows focus on reserve changes (65%) and 30-day extremes (35%), removing redundant balance trend and noisy single-day sigma.",
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
        a: "Each of four dimensions (Derivatives, ETFs, HTF, Exchange Flows) produces a conviction score from -100 to +100 relative to the trade direction — not a simple agree/disagree, but a granular measure of how strongly each dimension supports the trade. The total conviction ranges from -400 to +400. A directional trade is only taken when total >= 200 (or a lower dynamic threshold for compression setups). This keeps you out of low-conviction noise and ensures multiple independent data sources agree before risking capital. Sentiment was removed from scoring — it is a composite of the other three dimensions and would triple-count their signals.",
      },
    ],
  },
  {
    title: "Results measurement & evolution",
    items: [
      {
        q: "How are trade ideas tracked?",
        a: "Each idea generates seven independently-tracked price levels: four invalidation stops (at 1:2, 1:3, 1:4, and 1:5 risk-reward ratios) and three targets (T1 at 50% of target distance, T2 at 100%, T3 at 150% extension). The composite target is a weighted median of up to six levels: POC (25%), SMA-200 (20%), SMA-50 (15%), weekly VWAP (15%), monthly VWAP (15%), and the directional sweep level (10%), compressed by an RSI confidence multiplier. Each level resolves independently when price touches it.",
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
        a: "Yes, by design. The current weights and thresholds are a starting hypothesis. As outcome data accumulates, the system recalibrates based on what's actually predictive — not what seemed like it should be. A recent signal audit removed 11 noisy components from confluence scoring (HEATING_UP, DELEVERAGING, streak exhaustion, STRONG_INFLOW/OUTFLOW regime, regime score, market structure, sweep proximity, thin ice, flow sigma, balance trend, exchange-level divergence), replaced the HTF regime score with MA displacement (inverted sign — below MA = bullish pull), and removed sentiment entirely from scoring (triple-counting). Additional data dimensions (options/IV, macro indicators, prediction markets, stablecoin flows) are planned and will be integrated as they prove additive to signal quality.",
      },
    ],
  },
];

function FaqEntry({ q, a }: FaqItem) {
  return (
    <Collapsible title={q} variant="subtle">
      {a === "opportunityZones" ? (
        <div className="flex flex-col gap-2">
          {opportunityZones.map((z) => (
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
    </Collapsible>
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
