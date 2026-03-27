# Trade Idea Tracking System

Automated backtesting framework that measures the accuracy of the swing trading model by tracking every trade idea from creation to resolution.

---

## How It Works

### 1. Trade Idea Creation (happens after every brief)

When a brief is generated, a post-processing step extracts a structured trade idea:

**Direction extraction** — A small Claude call reads the brief text and outputs `LONG`, `SHORT`, or `FLAT`.

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

**Confluence scoring** — At creation time, each dimension's regime is mapped to an agreement score (+1, -1, 0) relative to the trade direction:

| Dimension | Agrees with LONG | Agrees with SHORT |
|-----------|-----------------|-------------------|
| Derivatives | CROWDED_SHORT, CAPITULATION, UNWINDING | CROWDED_LONG, HEATING_UP |
| ETFs | STRONG_INFLOW, REVERSAL_TO_INFLOW | STRONG_OUTFLOW, REVERSAL_TO_OUTFLOW |
| HTF | MACRO_BULLISH, RECLAIMING, ACCUMULATION, BEAR_EXTENDED | MACRO_BEARISH, DISTRIBUTION, BULL_EXTENDED |
| Sentiment | EXTREME_FEAR, FEAR, CONSENSUS_BULLISH | EXTREME_GREED, GREED, CONSENSUS_BEARISH |

HTF includes extended regimes in the opposite direction (mean-reversion logic). Sentiment is contrarian (fear = bullish for reversal).

**For FLAT ideas**: invalidation levels are breakout thresholds at multiples of ATR. No target levels — staying flat is measured by the returns curve.

### 2. Returns Curve Sampling (2x/day at 06:00 and 18:00 UTC)

The outcome checker runs daily and for each open trade idea:

1. Fetches 4H candles from Binance since the last check
2. For each candle, appends a return point to the shared `TradeIdeaReturn` series:
   - `hoursAfter` — hours since the idea was created
   - `price` — candle close price
   - `returnPct` — percentage return from entry (inverted for SHORT)
   - `qualityAtPoint` — return weighted by time decay

The returns curve continues until **all 7 levels** are resolved. This means even if a tight stop gets hit on day 1, the curve keeps recording so we can see what would have happened with a wider stop.

### 3. Level Resolution

Each level resolves independently:

- **TARGET levels** resolve as `WIN` when price reaches the level (candle high for LONG, candle low for SHORT)
- **INVALIDATION levels** resolve as `LOSS` when price reaches the level (candle low for LONG, candle high for SHORT)
- **FLAT invalidation** resolves as `LOSS` when price deviates beyond the breakout distance
- If both a target and invalidation could hit on the same candle, invalidation takes priority (conservative)
- After **30 days**, all remaining open levels are resolved as `LOSS` with quality = 0

### 4. Quality Score (Time Decay)

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

### 5. Data Model

```
TradeIdea
├── briefId          (links to parent brief)
├── asset            (BTC / ETH)
├── direction        (LONG / SHORT / FLAT)
├── entryPrice       (snapshot price at brief time)
├── compositeTarget  (weighted median of structure levels)
├── confluence       (JSON: per-dimension agreement scores)
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

Shows per-dimension win rates bucketed by agreement. Look for:
- **High delta between agreed/disagreed** = strong predictive dimension (e.g., derivatives agreed: 70% win rate, disagreed: 25%)
- **No delta** = noise dimension — consider reducing its weight in the synthesis prompt or F&G composite
- **Inverse delta** (disagreed > agreed) = the mapping is wrong — revisit the regime-to-direction logic for that dimension

### Signal Quality Over Time

Track the average quality score per week/month to detect model degradation. If quality trends downward:
- Market regime may have shifted (trending vs. ranging)
- Data source behavior changed (e.g., ETF flows are no longer mean-reverting)
- Thresholds need recalibration (funding percentiles drifted)

### Confluence Count Analysis

Count how many dimensions agreed for each trade idea and correlate with outcomes:
- 4/4 agree → what's the T2 hit rate?
- 3/4 agree → does it drop?
- 1/4 agree → does the model add value at all vs. random?

This directly tests the system's core thesis: cross-dimension confluence produces better signals.

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

### 2. Confluence Badge (per brief)

A compact row of 4 colored dots next to each brief in the list view:

- Green dot = dimension agreed (+1)
- Red dot = dimension disagreed (-1)
- Gray dot = neutral (0)

Labels: D (derivatives), E (ETFs), H (HTF), S (sentiment)

Example: `D🟢 E🔴 H🟢 S⚫` — 2 agreed, 1 disagreed, 1 neutral

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

A grouped bar chart with 4 dimension groups, each with 3 bars (agreed/neutral/disagreed), showing T2 win rate:

```
Derivatives:  ████████ 68% agreed  ████ 42% neutral  ██ 28% disagreed
ETFs:         ██████ 55% agreed    █████ 48% neutral  ████ 38% disagreed
HTF:          ████████ 65% agreed  ███ 35% neutral    ██ 22% disagreed
Sentiment:    ███████ 62% agreed   █████ 45% neutral  ███ 30% disagreed
```

The wider the gap between agreed and disagreed bars, the more predictive that dimension is. Dimensions should be sorted by predictive power (largest delta first).

### 5. Quality Timeline

A scatter plot of all resolved trade ideas over time:

**X-axis**: Date
**Y-axis**: Quality score
**Dot size**: Confluence count (bigger = more dimensions agreed)
**Dot color**: Green = WIN (T2), Red = LOSS

This shows if signal quality is improving, degrading, or stable. Cluster of red dots = bad period. Trending downward = model drift.

### 6. Summary Cards (Dashboard Homepage)

Four metric cards at the top of the trade ideas section:

- **Model Win Rate**: T2 win rate across all ideas (the headline number)
- **Best R:R**: Which invalidation level has the highest quality
- **Best Predictor**: Which dimension has the highest agreed/disagreed delta
- **Signal Strength**: Average confluence count for winning trades vs. losing trades

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/trades/latest/:asset` | Latest trade idea with full returns curve and levels |
| `GET /api/trades/history/:asset?take=30` | Paginated history of trade ideas |
| `GET /api/trades/stats/:asset` | Per-level win rates and quality scores |
| `GET /api/trades/confluence/:asset` | Per-dimension hit rates by agreement score |
| `GET /api/trades/by-brief/:briefId` | Trade idea for a specific brief |

## Pipeline Integration

- Trade ideas are created automatically after each brief (step 4/5 in notify pipeline)
- Outcome checker runs 2x/day at 06:00 and 18:00 UTC via the scheduler
- Manual check: `pnpm check-outcomes`

## File Structure

```
packages/pipeline/src/orchestrator/trade-idea/
├── index.ts              — barrel orchestrator (extract → compute → persist)
├── composite-target.ts   — weighted median target + R:R levels + target levels
├── confluence.ts         — regime → direction agreement mapper
├── extractor.ts          — LLM direction extraction (LONG/SHORT/FLAT)
├── persist.ts            — database write
├── outcome-checker.ts    — daily cron: returns sampling + level resolution
└── check.bin.ts          — CLI entry point

packages/pipeline/src/shared/
└── binance.ts            — lightweight candle fetcher (no caching)

packages/api/src/routes/
└── trade-ideas.ts        — API endpoints

packages/api/src/lib/
└── trade-ideas.ts        — data layer + stats queries
```
