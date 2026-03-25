# Data Dimensions

## Assets

This system covers **BTC** and **ETH**. Each asset gets its own pipeline run — all dimensions are evaluated per-asset.

Some dimensions are **asset-specific** (BTC mining, ETH staking) while others are **shared** (macro, geopolitics, prediction markets) and injected as context into both asset pipelines.

| Dimension type | Applies to | Example |
|---------------|-----------|---------|
| Per-asset | Each asset independently | Derivatives, technicals, exchange flows |
| Asset-specific | One asset only | BTC mining (16), ETH staking (17) |
| Shared | Both assets (same data) | Macro, geopolitics, cross-market, stablecoins |

## Dimension Model

Each dimension is an independent analytical lens on the market. Every dimension has:

- A **collector** that fetches raw data from APIs
- A **deterministic analyzer** that applies threshold rules and labels regimes
- An **LLM agent** that interprets what the data means in context

## Data Structure Model

### Two-tier collection

| Tier       | Frequency       | Dimensions                                                               | Why                                             |
| ---------- | --------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Continuous | 1h              | Derivatives (01), Options (02), Exchange flows (04), LTF technicals (08) | Intraday context needed for meaningful analysis |
| Periodic   | 3x/day or daily | All others                                                               | Data itself changes slowly or is event-driven   |
| Historical | Daily (batch)   | Derivatives (01), Whale activity (05)                                    | Hydromancer Reservoir — wallet-level Hyperliquid data via S3 parquet, enriches real-time sources |

### State machine + multi-timeframe context

High-frequency dimensions (especially derivatives) use a **state machine** model instead of raw time-series. The deterministic analyzer maintains a current regime state and logs transitions:

**Regime states** (derivatives example):

```
NEUTRAL → HEATING_UP → CROWDED_LONG → UNWINDING → CAPITULATION → NEUTRAL
                     → CROWDED_SHORT → SHORT_SQUEEZE →
```

**What the LLM agent receives** (computed entirely in code):

```typescript
{
  // Current regime from state machine
  regime: "CROWDED_LONG",
  since: "2026-03-15T17:00Z",
  duration: "35h",
  previousRegime: "HEATING_UP",

  // Multi-timeframe highs/lows for each metric
  funding: {
    current: 0.045,
    highs: { "1w": 0.052, "1m": 0.078, "3m": 0.12, "6m": 0.15, "1y": 0.23 },
    lows:  { "1w": 0.008, "1m": -0.03, "3m": -0.08, "6m": -0.12, "1y": -0.15 },
    percentile: { "1m": 82, "3m": 61, "1y": 45 },
  },
  openInterest: {
    current: 18.2e9,
    highs: { "1w": 18.5e9, "1m": 19.1e9, "3m": 22.4e9, "6m": 22.4e9, "1y": 24.1e9 },
    lows:  { "1w": 17.1e9, "1m": 15.8e9, "3m": 12.3e9, "6m": 10.1e9, "1y": 8.2e9 },
    percentile: { "1m": 74, "3m": 52, "1y": 38 },
  },
  liquidations: {
    current8h: 47e6,
    bias: "75% long",
    highs: { "1w": 120e6, "1m": 340e6, "3m": 890e6, "6m": 1.2e9, "1y": 2.1e9 },
    percentile: { "1m": 15, "3m": 8, "1y": 4 },
  },
  longShortRatio: {
    current: 2.1,
    highs: { "1w": 2.3, "1m": 2.8, "3m": 3.1, "6m": 3.5, "1y": 4.2 },
    lows:  { "1w": 1.4, "1m": 0.7, "3m": 0.5, "6m": 0.4, "1y": 0.3 },
    percentile: { "1m": 71, "3m": 55, "1y": 42 },
  },

  // Notable events since last brief
  events: [
    { type: "oi_spike", change: "+3.2%", window: "1h", at: "14:00" },
    { type: "funding_flip", direction: "negative_to_positive", at: "08:00" }
  ]
}
```

The multi-timeframe context (week/month/3m/6m/9m/year highs and lows + percentiles) lets the agent judge _scale_ — "funding at 0.045 feels high but is only 61st percentile over 3 months" — without needing raw historical data in the prompt.

Longer timeframe windows (3m+) can be seeded from CoinGlass historical endpoints and updated incrementally. Shorter windows (1w, 1m) are computed from hourly collection.

---

## 01 — Derivatives Structure

**What it watches:** Funding rates, open interest, liquidations, long/short ratio, taker buy/sell volume

**Why it matters:** Shows leverage buildup, crowding, and positioning. Funding extremes precede reversals. OI divergence from price signals new position building. Liquidation cascades accelerate moves.

**Data model:** State machine with regime transitions + multi-timeframe highs/lows (see above). Collected hourly.

**Regime states:**
`NEUTRAL` · `HEATING_UP` · `CROWDED_LONG` · `CROWDED_SHORT` · `UNWINDING` · `SHORT_SQUEEZE` · `CAPITULATION` · `DELEVERAGING`

**Transition rules (deterministic):**

- funding percentile(1m) > 80 + L/S > 2.0 → `CROWDED_LONG`
- funding percentile(1m) < 20 + L/S < 0.8 → `CROWDED_SHORT`
- OI dropping > 5% in 24h + liquidations percentile(1m) > 70 → `UNWINDING`
- funding negative 3+ cycles + OI declining → `DELEVERAGING`
- liquidations > percentile(3m) 90 + OI dropping sharply → `CAPITULATION`

**Source:** CoinGlass — funding rates, OI (OHLC + aggregated), liquidation history/heatmap, L/S ratio, taker volume

**Source (Hyperliquid-specific):** Hydromancer Reservoir — wallet-level position snapshots, tick-level fills and liquidations, leverage distribution. Enriches CoinGlass aggregates with granular on-chain data.

**Hyperliquid enrichment (from Hydromancer Reservoir):**

Hydromancer provides wallet-level Hyperliquid data via S3 parquet files (`s3://hydromancer-reservoir`, requester-pays, DuckDB-queryable). This adds a layer of granularity on top of CoinGlass aggregates:

- **Crowding analysis** — daily position snapshots contain every open position (user, market, size, notional, entry_price, leverage, leverage_type). Compute OI concentration in top N wallets, leverage distribution across the market, and long/short positioning by account size tier.
- **Liquidation microstructure** — tick-level liquidation fills include the liquidated wallet address, mark price at liquidation, liquidation method (cross/isolated), and position size before liquidation. Detect cascade patterns (clusters of liquidations within short time windows) that CoinGlass aggregates obscure.
- **L/S ratio from positions** — compute true long/short ratio from position snapshots by summing positive vs negative `size` values, weighted by notional. More accurate than exchange-reported ratios which may only cover top traders.
- **Leverage distribution** — histogram of leverage multipliers across all open positions. Detect when the market is over-leveraged (median leverage rising) even before funding reacts.

**Additional transition rules (Hyperliquid-specific):**

- top 10 wallets hold > 40% of OI → `CROWDED_LONG` or `CROWDED_SHORT` (concentrated risk)
- median leverage rising > 20% over 7d → `HEATING_UP` (strengthened)
- liquidation cluster: > 50 liquidations within 5 minutes → `CAPITULATION` event signal

---

## 02 — Options & Implied Volatility

**What it watches:** Max pain, put/call ratio, IV skew, OI by strike, term structure

**Why it matters:** Options market prices in forward expectations. Skew reveals directional bias of sophisticated traders. Max pain acts as a short-term price magnet near expiry. IV term structure shows whether the market expects near-term or longer-term moves.

**Data model:** State machine with multi-timeframe context. Collected hourly.

**Regime states:**
`LOW_VOL` · `VOL_EXPANSION` · `VOL_CRUSH` · `PUT_HEAVY` · `CALL_HEAVY` · `EXPIRY_PINNING` · `EVENT_PRICING`

**Transition rules (deterministic):**

- IV percentile(1m) < 20 → `LOW_VOL`
- IV rising > 20% in 24h without price move > 2% → `EVENT_PRICING`
- put/call ratio > 1.3 + skew favoring puts → `PUT_HEAVY`
- days to expiry < 3 + price within 2% of max pain → `EXPIRY_PINNING`

**Source:** CoinGlass — options OI, volume, max pain, exchange-level metrics

---

## 03 — Institutional Flows (ETFs)

**What it watches:** Daily net flows for BTC and ETH spot ETFs, Grayscale premiums/discounts

**Why it matters:** Direct measure of institutional demand. Multi-day flow trends signal conviction shifts. Grayscale premium/discount reflects arbitrage and sentiment.

**Key signals:**

- 3+ consecutive days of outflows → institutional appetite cooling
- Single-day flow > 2σ from mean → notable event
- Grayscale discount widening → bearish institutional signal

**Source:** CoinGlass — ETF flows (BTC, ETH), Grayscale holdings/premiums

---

## 04 — Exchange Flows & Liquidity

**What it watches:** Exchange balances (net deposits/withdrawals), exchange netflow, reserve changes over 7d/30d

**Why it matters:** Coins moving off exchanges = accumulation (less sell pressure). Coins moving onto exchanges = distribution (preparing to sell). Long-term trends in exchange reserves are one of the most reliable on-chain signals.

**Data model:** State machine with multi-timeframe context. Collected hourly.

**Regime states:**
`ACCUMULATION` · `DISTRIBUTION` · `NEUTRAL` · `HEAVY_INFLOW` · `HEAVY_OUTFLOW`

**Transition rules (deterministic):**

- 7d net outflow + reserve declining → `ACCUMULATION`
- 7d net inflow + reserve rising → `DISTRIBUTION`
- single-hour inflow > percentile(1m) 95 → `HEAVY_INFLOW` event
- reserve at 3m+ low → `ACCUMULATION` (strengthened)

**Source:** CoinGlass — exchange balances, on-chain flows

---

## 05 — Whale Activity

**What it watches:** Large transactions (>$1M), whale accumulation/distribution patterns, notable address movements

**Why it matters:** Whales move markets. Tracking large transfers to/from exchanges signals intent. Accumulation by known smart money addresses is a leading indicator.

**Key signals:**

- Cluster of large exchange inflows → selling pressure ahead
- Whale accumulation during fear → smart money buying
- Dormant wallet activation → long-term holder decision point

**Source:** CoinGlass — whale transfers, large order tracking, Hyperliquid whale positions

**Source (Hyperliquid-specific):** Hydromancer Reservoir — daily position snapshots, account values, builder/TWAP fills

**Hyperliquid enrichment (from Hydromancer Reservoir):**

Hydromancer transforms whale tracking from CoinGlass's curated alerts into a systematic, wallet-level dataset:

- **Whale position tracker** — daily snapshots of every wallet's positions. Filter by `notional > $1M` (or any threshold) to build a whale watchlist. Track day-over-day changes in position size, entry price, and leverage for each whale.
- **Account value distribution** — `account_values` dataset gives total equity per wallet per day. Track capital concentration (top 50 accounts as % of total), identify new large accounts entering, and detect capital flight (large accounts shrinking).
- **Smart money execution patterns** — `builder_fills` reveal which frontend/aggregator routed each trade. `twap_fills` show institutional-style TWAP executions. High TWAP volume in a market suggests sophisticated accumulation/distribution.
- **Whale realized PnL** — fills include `realized_pnl` per trade per wallet. Track whether whales are taking profit or cutting losses — a leading signal for directional conviction.

**Key signals (Hyperliquid-specific):**

- Top 20 accounts increasing BTC long notional > 10% in 24h → whale accumulation
- New wallet enters top 50 by account value → capital inflow from new participant
- TWAP fill volume > 2x daily average → institutional-scale execution underway
- Top whale wallets net reducing positions → smart money de-risking

---

## 06 — Market Sentiment (Composite Fear & Greed)

**What it watches:** Composite Fear & Greed index computed from four components — derivatives positioning (Dim 01), HTF trend (Dim 07), institutional flows (Dim 03), and accuracy-weighted expert consensus (unbias API).

**Why it matters:** Traditional Fear & Greed indices (Alternative.me, CNN) use opaque methodology and produce unreliable readings — during testing, Alternative.me showed 14 (Extreme Fear) while actual market conditions (derivatives, trend, expert consensus) all indicated neutral-to-mild-greed territory. Our composite uses crypto-native inputs we control and understand.

**Data model:** State machine driven by composite score (0–100). Collected 3x/day (aligns with brief schedule).

**Component weights:**

| Component | Weight | Source | What it measures |
|-----------|--------|--------|-----------------|
| Positioning | 30% | Dim 01 (derivatives) | Funding rates, L/S ratio, OI percentiles, regime |
| Trend | 25% | Dim 07 (HTF technicals) | Price vs 50/200 SMA, RSI, market structure |
| Institutional flows | 20% | Dim 03 (ETF flows) | Flow streaks, σ magnitude, regime |
| Expert consensus | 25% | unbias API | Accuracy-weighted analyst consensus, z-score |

**Regime states:**
`EXTREME_FEAR` · `FEAR` · `NEUTRAL` · `GREED` · `EXTREME_GREED` · `CONSENSUS_BULLISH` · `CONSENSUS_BEARISH` · `SENTIMENT_DIVERGENCE`

**Transition rules (deterministic):**

- composite < 20 → `EXTREME_FEAR`
- composite > 80 → `EXTREME_GREED`
- composite 20–40 → `FEAR`
- composite 60–80 → `GREED`
- composite 40–60 → `NEUTRAL`
- unbias z-score ≥ +0.8 + composite > 70 → `CONSENSUS_BULLISH` (experts and data aligned bullish)
- unbias z-score ≤ -1.5 + composite < 30 → `CONSENSUS_BEARISH` (experts and data aligned bearish)
- unbias z-score ≥ +0.8 + composite < 30, or z-score ≤ -1.5 + composite > 70 → `SENTIMENT_DIVERGENCE` (experts vs data disagree — most actionable)

**Key signals:**

- Composite < 20 → extreme fear across all inputs
- Composite > 80 → extreme greed across all inputs
- unbias z-score ≥ +0.8 → analyst consensus bullish
- unbias z-score ≤ -1.5 → analyst consensus bearish
- Internal component divergence (one component >70 while another <30) → mixed regime, watch for resolution
- `SENTIMENT_DIVERGENCE` → experts and composite disagree, historically highest-probability contrarian signal

**Source:** unbias API (analyst consensus — free tier: 100 req/day, daily granularity), cross-dimension data from Dims 01, 03, 07

**unbias API details:**

| Endpoint | Data | Use |
|----------|------|-----|
| `GET /api/v1/consensus` | Consensus index (-100 to +100), 30d MA, 90d z-score, bullish/bearish analyst counts | Expert sentiment per asset (BTC, ETH, ALL) |
| `GET /api/v1/sentiment` | Per-analyst sentiment scores (0–1), filterable by handle | Drill-down: which analysts are driving consensus shifts |

Auth: `X-API-Key` header. Free tier: 100 req/day, daily granularity, current data only. Pro ($49/mo): 1000 req/min, hourly granularity, full history.

---

## 07 — HTF Technical Structure

**What it watches:** Weekly/daily chart structure — key support/resistance, trend direction, RSI, moving averages (50/200 DMA), market structure (HH/HL/LH/LL)

**Why it matters:** Defines the macro regime. Are we in a trend or range? Where are the structural levels that matter? HTF structure overrides LTF noise.

**Key signals:**

- Price below 200 DMA → macro bearish regime
- Weekly RSI > 70 → overbought on high timeframe
- Break of major structure level → trend change confirmation
- Golden/death cross → trend momentum shift

**Source:** CoinGlass (indicators), CCXT (OHLCV data for custom calculation)

---

## 08 — LTF Technical Structure

**What it watches:** 4H/1H chart — momentum, short-term levels, volume profile, intraday structure

**Why it matters:** Provides timing context within the HTF regime. Useful for "what's happening right now" — is the market trending intraday or chopping?

**Data model:** State machine with multi-timeframe context. Collected hourly.

**Regime states:**
`TRENDING_UP` · `TRENDING_DOWN` · `RANGING` · `BREAKOUT` · `BREAKDOWN` · `SQUEEZE` · `EXPANSION`

**Transition rules (deterministic):**

- 4H making HH+HL + RSI > 50 → `TRENDING_UP`
- Bollinger width percentile(1m) < 10 → `SQUEEZE`
- break above 4H range high + volume > avg → `BREAKOUT`

**Source:** CCXT (OHLCV data), CoinGlass (RSI, Bollinger, MACD)

---

## 09 — Macro Environment

**What it watches:** Fed funds rate, CPI/Core PCE inflation, nonfarm payrolls, initial jobless claims, GDP, DXY (dollar index), Treasury yields (2Y/10Y), M2 money supply

**Why it matters:** Crypto doesn't exist in a vacuum. Rate expectations drive risk appetite. Dollar strength inversely correlates with crypto. Liquidity expansion (M2) is a macro tailwind.

**Key signals:**

- CPI surprise above expectations → risk-off, rate hike fears
- Fed dovish pivot / rate cut → risk-on tailwind
- DXY breakout above key level → headwind for crypto
- M2 expansion accelerating → liquidity tailwind
- Yield curve inversion deepening/normalizing → recession signal

**Source:** FRED API (free — 800k+ time series), BLS API (free — CPI, employment)

---

## 10 — Geopolitics & News

**What it watches:** Breaking news, regulatory developments, exchange incidents, protocol events, geopolitical risk events

**Why it matters:** News catalysts create volatility and shift narratives. Regulatory news (SEC, EU) can move markets for days. Distinguishing noise from signal is the agent's main job here.

**Key signals:**

- Regulatory action (SEC suit, ban, approval) → high impact
- Exchange hack/insolvency → contagion risk
- War/sanctions escalation → risk-off
- Major protocol upgrade/incident → asset-specific

**Source:** CryptoPanic (aggregated news + sentiment votes — free tier), CryptoCompare

---

## 11 — Cross-Market Correlations

**What it watches:** BTC correlation with SPX, Nasdaq, gold, DXY, bonds. Relative performance of crypto vs traditional risk assets.

**Why it matters:** When correlations are high, crypto follows macro. When they decouple, crypto is trading on its own narrative. Correlation regime itself is a signal — high correlation = macro-driven, low correlation = crypto-native drivers.

**Key signals:**

- BTC-SPX 30d correlation > 0.7 → macro-driven regime
- BTC-SPX correlation breaking down → narrative shift
- BTC-gold correlation rising → "digital gold" trade active
- Crypto outperforming during equity selloff → strength signal

**Source:** CCXT (crypto prices), FRED/Yahoo Finance (SPX, gold, DXY, bond yields)

---

## 12 — Prediction Markets

**What it watches:** Crypto-relevant prediction market odds — price targets, ETF approvals, regulatory outcomes, election impacts on crypto policy

**Why it matters:** Prediction markets aggregate informed opinion with real money at stake. Rapid probability shifts reveal changing consensus before it shows up in price.

**Key signals:**

- Price target probability dropping >15% in 48h → conviction weakening
- Regulatory outcome odds shifting → front-run the narrative
- High-confidence market (>85%) → priced in, move on news unlikely
- New high-volume market created → emerging narrative

**Source:** Polymarket API (free, no auth for read-only). [Docs](https://docs.polymarket.com/api-reference/introduction)

---

## 13 — Stablecoin Flows

**What it watches:** USDT/USDC circulating supply, mint/burn events, market cap changes, per-chain distribution, stablecoin dominance

**Why it matters:** Stablecoin minting = new capital entering crypto. Burning = capital exiting. Stablecoin dominance rising = risk-off rotation within crypto. These are the "dry powder" and "exit" signals.

**Key signals:**

- Large USDT/USDC mint (>$500M) → capital inflow, bullish
- Stablecoin dominance rising + price falling → flight to safety
- Stablecoin supply on exchanges rising → buying power accumulating
- USDC/USDT ratio shifting → regional flow indicator (US vs offshore)

**Source:** DefiLlama stablecoins API (free — supply, mint/burn, per-chain breakdown)

---

## 14 — DeFi Activity

**What it watches:** Total TVL, TVL by chain, DEX vs CEX volume ratio, protocol-level TVL shifts, yield trends

**Why it matters:** TVL reflects capital commitment to on-chain ecosystems. DEX volume spikes during volatility. TVL migration between chains signals narrative rotation. Yield compression/expansion reflects risk appetite.

**Key signals:**

- TVL dropping while price stable → capital leaving, bearish divergence
- DEX/CEX volume ratio spiking → on-chain activity surge (often during fear)
- TVL rotating to new chain → emerging narrative
- Yield compression across DeFi → risk appetite low

**Source:** DefiLlama (free — TVL, DEX volumes, protocol data)

---

## 15 — Token Unlocks & Supply Events

**What it watches:** Upcoming token unlock schedules, vesting cliff events, large supply expansions, emission rate changes

**Why it matters:** Supply shocks move prices. A large unlock (>2% of circulating supply) creates sell pressure as investors/team take profit. Markets often front-run unlocks by days.

**Key signals:**

- Unlock > 2% of circulating supply within 7 days → sell pressure risk
- Cliff unlock (vs linear) → concentrated impact
- Multiple large unlocks across assets in same week → sector-wide pressure
- Post-unlock price stability → absorbed, bullish

**Source:** CoinGlass (token unlocks/vesting schedules)

---

## 16 — BTC Mining Activity (BTC only)

**What it watches:** Hash rate, mining difficulty, miner revenue, miner outflows to exchanges, hash price, block production rate

**Why it matters:** Miners are forced sellers — they have operational costs. When miner revenue drops (hash price low), they sell reserves, creating sell pressure. Hash rate trends reflect long-term miner conviction. Difficulty adjustments signal miner capitulation or expansion. Post-halving dynamics directly affect supply economics.

**Key signals:**

- Hash rate dropping + difficulty adjustment down → miner capitulation (historically bullish after the flush)
- Miner outflows to exchanges spiking → selling to cover costs, near-term pressure
- Hash price at cycle lows → miners under stress, weaker miners shutting down
- Hash rate ATH + stable difficulty → network healthy, miners profitable and expanding
- Post-halving revenue squeeze → watch for miner sell waves in following months

**Source:** CoinGlass (mining metrics), Glassnode free tier (hash rate, miner revenue)

---

## 17 — ETH Staking & Network Activity (ETH only)

**What it watches:** Staking rate (% of supply staked), validator entry/exit queue, staking APR, net staking flows, blob fees (L2 activity), burn rate (EIP-1559), supply growth/deflation rate

**Why it matters:** ETH's economic model is fundamentally different from BTC. Staking locks supply — high staking rate = less liquid supply = bullish pressure. Validator exit queues signal large staker sentiment. Burn rate determines whether ETH is inflationary or deflationary. L2 activity (blob fees) reflects real usage demand.

**Key signals:**

- Validator exit queue growing → large stakers leaving, potential sell pressure
- Staking APR dropping significantly → yield compression, may trigger unstaking
- Burn rate > issuance → deflationary period, supply shrinking
- Blob fees spiking → L2 demand surge, bullish for network utility
- Net staking outflows sustained → confidence weakening
- Staking rate > 30% → significant supply locked, liquidity squeeze potential

**Source:** Glassnode free tier (ETH 2.0 metrics, staking deposits, validators), DefiLlama (ETH burn, L2 activity)

---

## 18 — Equities Market Structure

**What it watches:** S&P 500 and Nasdaq structure — VIX level/term structure, put/call ratio, index vs key moving averages (20/50/200 DMA), market breadth (advance/decline, new highs/lows, % above 50/200 DMA), sector rotation and participation rate

**Why it matters:** Crypto trades in the shadow of equities during high-correlation regimes (dimension 11). But even in low-correlation periods, a hostile equity environment (deteriorating breadth, rising VIX, breakdown below key MAs) creates a risk-off backdrop that suppresses capital flows into crypto. This dimension answers "is the broader risk environment healthy or fragile?" — context that the macro dimension (09) doesn't capture because macro tracks policy inputs (rates, CPI) while this tracks market outputs (how equities are actually behaving).

**Data model:** Composite scoring with sub-pillar breakdown. Collected 3x/day (aligns with brief schedule).

**Sub-pillars (each scored 0–100, weighted):**

| Sub-pillar | Weight | Inputs |
|---|---|---|
| Volatility | 20% | VIX level, VIX percentile (1m/3m), VIX term structure (contango/backwardation), equity put/call ratio |
| Trend | 30% | SPX vs 20/50/200 DMA, QQQ vs 20/50/200 DMA, slope of 50 DMA |
| Breadth | 25% | % of S&P 500 above 50 DMA, % above 200 DMA, NYSE advance/decline ratio, new highs vs new lows |
| Momentum | 15% | Sector leader/laggard spread, % of sectors in uptrend, RSI (SPX weekly) |
| Event risk | 10% | FOMC within 48h, major earnings week, options expiry proximity |

**Composite score interpretation:**

| Score | Label | Meaning |
|---|---|---|
| 70–100 | `FAVORABLE` | Healthy equity environment — trend intact, breadth confirming, low vol. Risk-on tailwind for crypto. |
| 40–69 | `MIXED` | Selective conditions — some pillars healthy, others deteriorating. Crypto may decouple or follow. |
| 0–39 | `HOSTILE` | Broad equity weakness — poor breadth, elevated vol, broken trend. Risk-off headwind for crypto. |

**Regime states:**
`FAVORABLE` · `MIXED` · `HOSTILE` · `VOLATILITY_EVENT` · `BREADTH_DIVERGENCE` · `TREND_TRANSITION`

**Transition rules (deterministic):**

- composite > 70 → `FAVORABLE`
- composite 40–70 → `MIXED`
- composite < 40 → `HOSTILE`
- VIX > 25 + VIX term structure in backwardation → `VOLATILITY_EVENT` (overrides composite)
- SPX making new highs + % above 50 DMA < 50% → `BREADTH_DIVERGENCE` (warning: rally narrowing)
- SPX crossing 200 DMA (either direction) + breadth confirming → `TREND_TRANSITION`

**Key signals:**

- Composite dropping from FAVORABLE to HOSTILE within 1 week → rapid deterioration, high alert
- Breadth divergence persisting > 5 days → distribution underway, fragile rally
- VIX term structure flipping to backwardation → near-term fear exceeding far-term, event-driven
- % above 200 DMA < 40% → broad damage, not just index-level weakness
- Composite recovering from HOSTILE while crypto hasn't bounced → potential crypto catch-up trade

**Relationship to other dimensions:**

- **Dimension 09 (Macro):** Macro tracks policy inputs; this tracks market outputs. Fed can be dovish while equities break down (and vice versa).
- **Dimension 11 (Cross-Market Correlations):** Correlations tell you _how linked_ crypto is to equities; this tells you _what equities are actually doing_. Both matter.

**Source:** FRED API (free — VIX via CBOE, S&P 500, advance/decline), Yahoo Finance (sector ETFs, breadth data, moving averages), CBOE (put/call ratio)

---

## Data Source Summary

| Source         | Dimensions Covered                    | Cost              | Auth              |
| -------------- | ------------------------------------- | ----------------- | ----------------- |
| CoinGlass      | 01, 02, 03, 04, 05, 07, 08, 15, 16   | $29/mo (Hobbyist) | API key           |
| Glassnode      | 16, 17                                | Free (Standard)   | API key           |
| CCXT           | 07, 08, 11                            | Free              | Per-exchange keys |
| unbias         | 06                                    | Free (100 req/day) | API key          |
| CryptoPanic    | 10                                    | Free tier         | API token         |
| CryptoCompare  | 10                                    | Free tier         | API key           |
| FRED           | 09, 11, 18                            | Free              | API key           |
| Polymarket     | 12                                    | Free              | None              |
| DefiLlama      | 13, 14, 17                            | Free              | None              |
| Yahoo Finance  | 11, 18                                | Free              | None              |
| CBOE           | 18                                    | Free              | None              |
| Hydromancer    | 01, 05                                | Free (S3 requester-pays) | None (public S3 bucket) |

**Total data cost: ~$29/mo** (CoinGlass only paid source, Hydromancer S3 transfer costs and unbias free tier are negligible)

### Hydromancer Reservoir

S3-based data warehouse for Hyperliquid historical data. Not a REST API — data is stored as Parquet files queryable via DuckDB.

**Bucket:** `s3://hydromancer-reservoir` (requester-pays, region `ap-northeast-1`)
**Data available from:** 2025-07-28 (complete data from this date onward)
**Update frequency:** Daily
**Known gap:** Late October to mid-December 2025 snapshot data missing (ABCI state capture gap)

**Datasets used:**

| Dataset | S3 Path | Schema |
|---|---|---|
| Perp fills (all trades) | `by_dex/hyperliquid/fills/perp/all/date=YYYY-MM-DD/fills.parquet` | 26 columns: coin, price, size, side, timestamp, direction, address, realized_pnl, fee, crossed, start_position, leverage info, liquidation fields |
| Liquidations | `by_dex/hyperliquid/fills/perp/liquidations/date=YYYY-MM-DD/fills.parquet` | Same as fills + liquidation_mark_px, liquidation_method |
| TWAP fills | `by_dex/hyperliquid/fills/perp/twap_fills/date=YYYY-MM-DD/fills.parquet` | Same as fills + twap_id |
| Builder fills | `by_dex/hyperliquid/fills/perp/builder_fills/date=YYYY-MM-DD/fills.parquet` | Same as fills + builder, builder_fee |
| 1s candles | `by_dex/hyperliquid/candles/1s/date=YYYY-MM-DD/candles.parquet` | coin, timestamp, OHLCV, volume_quote, trade_count |
| Perp position snapshots | `by_dex/hyperliquid/snapshots/perp/date=YYYY-MM-DD/*.parquet` | user, market, size, notional, entry_price, liquidation_price, leverage_type, leverage, funding_pnl, account_value, account_mode |
| Account values | `global/snapshots/account_values/date=YYYY-MM-DD/*.parquet` | user, dex, collateral_token, account_value, total_long_notional, total_short_notional, account_mode |
| Spot holdings | `global/snapshots/spot/date=YYYY-MM-DD/*.parquet` | user, token, balance, entry_value |

**Integration:** `duckdb` package (npm or Python). Setup:

```sql
INSTALL httpfs;
LOAD httpfs;
SET s3_region = 'ap-northeast-1';

-- Example: top BTC positions by notional
SELECT user, size, notional, entry_price, leverage, leverage_type
FROM read_parquet('s3://hydromancer-reservoir/by_dex/hyperliquid/snapshots/perp/date=2026-03-22/*.parquet')
WHERE market = 'BTC'
ORDER BY abs(size) DESC LIMIT 20;
```

**Docs:** [docs.hydromancer.xyz/reservoir/hyperliquid](https://docs.hydromancer.xyz/reservoir/hyperliquid)
