# Trade Idea Tracking System

Automated backtesting framework that measures the accuracy of the swing trading model by tracking every trade idea from creation to resolution.

---

## How It Works

### 1. Trade Idea Creation (mechanical — no LLM involved)

When a brief is generated, a fully mechanical process computes the trade idea **before** the LLM synthesizer runs:

**Direction selection** — The system scores all three directions (LONG, SHORT, FLAT) mechanically using granular confluence scoring (-100 to +100 per dimension). The directional candidate with the highest total is selected. If no direction passes the conviction threshold (200/400), the best directional candidate is still tracked but marked as `skipped`.

**Confluence scoring** — Each of four dimensions produces a conviction score from -100 to +100 relative to the trade direction:

| Dimension | Weight Components | Key Signals |
|-----------|-------------------|-------------|
| Derivatives (40% positioning, 25% stress, 20% funding, 15% OI) | Crowded positioning, capitulation/unwinding stress events, funding percentile extremes, OI as multiplier |
| ETFs (40% flow sigma, 25% streak, 20% regime, 15% reversal) | Flow sigma with regime-contradiction bonus, streak exhaustion (contrarian), regime direction, reversal ratio |
| HTF (30% RSI, 30% CVD, 20% volatility, 10% regime, 10% structure) | RSI confidence (distance from 50), CVD divergence with R² quality, volatility compression ("coiled spring"), regime/structure complementary |
| Sentiment (55% composite, 25% convergence, 20% regime) | Contrarian F&G with extreme boost, component convergence count, regime. Expert consensus excluded. |

**Conviction gate** — Total conviction ranges from -400 to +400. A directional trade is only "taken" when total >= 200. Below threshold, the idea is saved with `skipped: true` for accuracy measurement.

**Skipped ideas are always tracked** — returns and level outcomes are recorded even for skipped ideas, so we can measure "missed moves." The time-decay quality formula naturally weights fast misses higher than slow ones (missing a 5% move in 4h is a bigger model failure than missing 5% over 2 weeks).

**Composite target calculation** — A weighted median of four structure levels, adjusted by RSI confidence:

| Level | Weight |
|-------|--------|
| SMA 50 | 0.30 |
| SMA 200 | 0.25 |
| VWAP weekly | 0.25 |
| VWAP monthly | 0.15 |

RSI acts as a confidence multiplier. When RSI is at an extreme (near 0 or 100), the target stands at full distance from entry — mean-reversion levels are trustworthy. When RSI is near 50, the target compresses toward the entry price (0.3x floor so targets always have some distance).

**Multiple levels** — Each trade idea produces 7 independently-tracked levels:

Invalidation (stop loss) levels derived from R:R ratios:
- `1:2` — widest stop (target distance / 2)
- `1:3` — standard swing stop
- `1:4` — tighter
- `1:5` — tightest stop

Target (take profit) levels at fractions of the composite target distance:
- `T1` — 50% of target distance (conservative)
- `T2` — 100% (full composite target)
- `T3` — 150% (overshoot / extended)

**For FLAT ideas**: invalidation levels are breakout thresholds at ATR-based distances (higher R:R = tighter, matching directional semantics: 1:2 = 1.5×ATR, 1:3 = 1.25×ATR, 1:4 = 1.0×ATR, 1:5 = 0.75×ATR). No target levels — staying flat is measured by the returns curve.

**Volatility compression detection** — The HTF analyzer computes a "coiled spring" signal:
- ATR percentile rank within last 50 4h candles (low = compressed)
- Recent displacement: max price move in last 30 candles, ATR-normalized
- When ATR is in the bottom 30th percentile AND displacement >= 2 ATR units, the compression flag fires
- This amplifies conviction in whichever direction other signals (RSI, CVD) point

### 2. Pipeline Flow

The pipeline runs in this order:

1. **Dimension pipelines** — 5 dimensions run in parallel (derivatives, ETFs, HTF, exchange flows, sentiment)
2. **Trade idea** (mechanical) — score all 3 directions, pick best, compute levels, persist
3. **Rich brief** (LLM) — infographic JSON from dimension interpretations
4. **Text brief** (LLM) — condenses rich brief + trade decision into Telegram-friendly text

The trade decision is computed **before** the LLM runs. The LLM describes the decision — it does not make it.

### 3. Returns Curve Sampling (2x/day at 06:00 and 18:00 UTC)

The outcome checker runs daily and for each open trade idea (including skipped ones):

1. Fetches 4H candles from Binance since the last check
2. For each candle, appends a return point to the shared `TradeIdeaReturn` series:
   - `hoursAfter` — hours since the idea was created
   - `price` — candle close price
   - `returnPct` — percentage return from entry (inverted for SHORT)
   - `qualityAtPoint` — return weighted by time decay

The returns curve continues until **all 7 levels** are resolved. This means even if a tight stop gets hit on day 1, the curve keeps recording so we can see what would have happened with a wider stop.

### 4. Level Resolution

Each level resolves independently:

- **TARGET levels** resolve as `WIN` when price reaches the level (candle high for LONG, candle low for SHORT)
- **INVALIDATION levels** resolve as `LOSS` when price reaches the level (candle low for LONG, candle high for SHORT)
- **FLAT invalidation** resolves as `LOSS` when price deviates beyond the breakout distance
- If both a target and invalidation could hit on the same candle, invalidation takes priority (conservative)
- After **30 days**, all remaining open levels are resolved as `LOSS` with quality = 0

### 5. Quality Score (Time Decay)

Every resolved level gets a quality score:

```
quality = returnPct × e^(-hoursAfter / 72)
```

Where 72 hours (~3 days) is the decay constant. This means:

| Resolved after | Decay multiplier | Interpretation |
|----------------|-----------------|----------------|
| 4h | 0.95 | Signal played out fast — high quality |
| 1d | 0.72 | Strong signal |
| 3d | 0.37 | Moderate |
| 5d | 0.19 | Weak — took a long time |
| 7d | 0.10 | Barely above noise |

A LONG that hits T2 in 8 hours gets a high positive quality. A LONG that hits T2 after 10 days gets a low positive quality — technically correct but not a strong signal.

Same for stops: getting stopped out fast = strongly wrong signal. Getting stopped out slowly = mildly wrong.

### 6. Missed Move Detection (for skipped ideas)

Skipped ideas are tracked with the same returns curve and level resolution. The UI shows a "missed move" indicator with three severity levels based on peak quality-weighted return:

- **Negligible** (quality < 1) — no significant move, skip was correct
- **Notable** (quality 1-3) — moderate move happened, worth noting
- **Significant miss** (quality > 3) — fast, large move in the predicted direction — model was too conservative

This directly measures conviction gate accuracy: are we skipping ideas that would have worked?

### 7. Data Model

```
TradeIdea
├── briefId          (links to parent brief)
├── asset            (BTC / ETH)
├── direction        (LONG / SHORT / FLAT)
├── entryPrice       (snapshot price at brief time)
├── compositeTarget  (weighted median of structure levels)
├── confluence       (JSON: { derivatives, etfs, htf, sentiment, total } each -100..+100)
├── skipped          (boolean: true when conviction < 200)
├── createdAt
│
├── levels[]         (7 rows: 4 invalidation + 3 target)
│   ├── type         (INVALIDATION / TARGET)
│   ├── label        ("1:2", "1:3", "1:4", "1:5", "T1", "T2", "T3")
│   ├── price        (the price level)
│   ├── outcome      (OPEN / WIN / LOSS)
│   ├── qualityScore (returnPct × time decay at resolution)
│   └── resolvedAt
│
└── returns[]        (one row per 4H candle, shared across all levels)
    ├── hoursAfter
    ├── price
    ├── returnPct
    └── qualityAtPoint
```

---

## How to Use It to Improve the System

### Optimal R:R Discovery

After accumulating 50+ trade ideas, query the stats endpoint to compare levels:

```
GET /api/trades/stats/BTC
```

Response shows per-level win rates and average quality. Look for:
- **Which stop survives best**: If 1:2 has 65% win rate but 1:5 only 30%, the model's signals need wide stops — price often dips before moving in the predicted direction
- **Where to take profit**: If T1 hits 75% of the time but T3 only 25%, the model catches direction but not magnitude — configure tighter take-profits
- **Quality sweet spot**: High win rate with high average quality = the ideal level

### Dimension Attribution

The confluence stats endpoint reveals which dimensions are actually predictive:

```
GET /api/trades/confluence/BTC
```

Shows per-dimension win rates bucketed by score (positive/negative/neutral). Look for:
- **High delta between positive/negative** = strong predictive dimension (e.g., derivatives positive: 70% win rate, negative: 25%)
- **No delta** = noise dimension — consider reducing its weight in the scoring
- **Inverse delta** (negative > positive) = the scoring logic is wrong — revisit the regime-to-direction mapping for that dimension

### Conviction Threshold Calibration

Compare outcomes for taken vs. skipped ideas:
- If skipped ideas have a high "significant miss" rate → threshold is too strict, lower it
- If taken ideas have a poor win rate → threshold is too loose, raise it
- Current threshold: 200/400

### Signal Quality Over Time

Track the average quality score per week/month to detect model degradation. If quality trends downward:
- Market regime may have shifted (trending vs. ranging)
- Data source behavior changed (e.g., ETF flows are no longer mean-reverting)
- Thresholds need recalibration (funding percentiles drifted)

### Confluence Score Analysis

Correlate the total confluence score at creation with outcomes:
- Do ideas with total > 300 outperform ideas with total 200-300?
- Is there a score threshold above which win rate plateaus?
- Which individual dimension score most predicts T2 hit rate?

This directly tests the system's core thesis: higher granular conviction produces better signals.

### Regime-Specific Performance

Slice trade idea outcomes by the HTF regime at creation time:
- Does the model perform better in RANGING vs. MACRO_BULLISH markets?
- Are FLAT signals accurate in RANGING and wrong in trending?
- Does BEAR_EXTENDED → LONG (reversion) actually work?

---

## How to Visualize in the Web App

### 1. Returns Chart (per brief)

Display on every brief detail page. A line chart showing the price path after the trade idea was created:

**X-axis**: Hours since brief (0 to resolution or 30 days)
**Y-axis**: Return % from entry

**Elements**:
- **Continuous line**: The returns curve (returnPct over time), colored green when positive, red when negative
- **Horizontal lines**: All 7 levels as dashed lines, color-coded:
  - Target levels (T1, T2, T3) in green shades (lighter = closer)
  - Invalidation levels (1:2, 1:3, 1:4, 1:5) in red shades (lighter = wider)
- **Markers**: Dots where each level resolved:
  - Green circle with checkmark = WIN (target hit)
  - Red circle with X = LOSS (invalidation hit)
  - Gray circle = expired (30-day cutoff)
- **Direction indicator**: Arrow up (LONG), arrow down (SHORT), or dash (FLAT) with the entry price

**Tooltip**: On hover over any point, show: time, price, return %, which levels were still open at that moment.

### 2. Confluence Breakdown (per brief)

Per-dimension horizontal bar chart showing conviction scores:
- Each dimension: bar extends right (green) for positive scores, left (red) for negative
- Centered at zero, range -100 to +100
- Conviction meter at the bottom: full-width progress bar with 200 threshold marker

For skipped ideas: "Missed Move" indicator showing peak quality-weighted return with severity coloring.

### 3. Level Performance Dashboard

A table or bar chart showing all 7 levels with their aggregate stats:

```
Level    | Win Rate | Avg Quality | Total
---------|----------|-------------|------
1:2      | 65%      | +2.1        | 48
1:3      | 52%      | +1.4        | 48
1:4      | 41%      | +0.3        | 48
1:5      | 31%      | -0.8        | 48
T1       | 72%      | +3.1        | 48
T2       | 45%      | +1.9        | 48
T3       | 28%      | +0.7        | 48
```

Color the win rate cells on a gradient (red < 40%, yellow 40-60%, green > 60%).

Highlight the "optimal strategy" row — the stop with highest quality + the target with highest quality.

### 4. Confluence Attribution Chart

A grouped bar chart with 4 dimension groups, each with 3 bars (positive/neutral/negative), showing T2 win rate. The wider the gap between positive and negative bars, the more predictive that dimension is. Dimensions should be sorted by predictive power (largest delta first).

### 5. Quality Timeline

A scatter plot of all resolved trade ideas over time:

**X-axis**: Date
**Y-axis**: Quality score
**Dot size**: Total confluence score (bigger = higher conviction)
**Dot color**: Green = WIN (T2), Red = LOSS, Gray = SKIPPED

This shows if signal quality is improving, degrading, or stable. Cluster of red dots = bad period. Trending downward = model drift.

### 6. Summary Cards (Dashboard Homepage)

Four metric cards at the top of the trade ideas section:

- **Model Win Rate**: T2 win rate across taken ideas (the headline number)
- **Best R:R**: Which invalidation level has the highest quality
- **Best Predictor**: Which dimension has the highest positive/negative delta
- **Skip Accuracy**: % of skipped ideas that correctly had no significant move

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/trades/latest/:asset` | Latest trade idea with full returns curve and levels |
| `GET /api/trades/history/:asset?take=30` | Paginated history of trade ideas |
| `GET /api/trades/stats/:asset` | Per-level win rates and quality scores |
| `GET /api/trades/confluence/:asset` | Per-dimension hit rates by score bucket |
| `GET /api/trades/by-brief/:briefId` | Trade idea for a specific brief |

## Pipeline Integration

- Trade ideas are computed mechanically before the LLM synthesizer (step 2/4 in pipeline)
- LLM synthesizer receives the trade decision and describes it (step 3-4/4)
- Outcome checker runs 2x/day at 06:00 and 18:00 UTC via the scheduler
- Manual check: `pnpm check-outcomes`

## File Structure

```
packages/pipeline/src/orchestrator/trade-idea/
├── index.ts              — barrel orchestrator (score all directions → pick best → persist)
├── composite-target.ts   — weighted median target + R:R levels + target levels
├── confluence.ts         — granular confluence scoring (-100 to +100 per dimension)
├── persist.ts            — database write (always persists, skipped flag)
├── outcome-checker.ts    — daily cron: returns sampling + level resolution
└── check.bin.ts          — CLI entry point

packages/pipeline/src/htf/
├── types.ts              — HtfContext with VolatilityContext (coiled spring detection)
└── analyzer.ts           — ATR series, compression detection, all technical indicators

packages/pipeline/src/orchestrator/
├── synthesizer.ts        — text brief (condenses rich brief + trade decision for Telegram)
├── rich-synthesizer.ts   — infographic JSON brief (input to text synthesizer)
└── run.ts                — pipeline flow: dimensions → trade idea → rich brief → text brief

packages/pipeline/src/scripts/
├── debug-confluence.ts   — sanity-check confluence scoring with live data
├── debug-outcome-checker.ts — inspect trade ideas, levels, returns in DB
└── debug-synthesizer.ts  — full pipeline debug: dimensions → decision → LLM input → output

packages/api/src/routes/
└── trade-ideas.ts        — API endpoints + confluence stats

packages/api/src/lib/
└── trade-ideas.ts        — data layer + stats queries

packages/web/app/components/
├── TradeIdeaSection.tsx   — trade idea display with missed move indicator
└── ConfluenceBadges.tsx   — inline badges + full breakdown with conviction meter
```
