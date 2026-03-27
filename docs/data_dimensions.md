# Data Dimensions

## Implementation Status

| Dimension | Name | Status |
|-----------|------|--------|
| 01 | Derivatives Structure | **Implemented** |
| 02 | Options & Implied Volatility | Planned |
| 03 | Institutional Flows (ETFs) | **Implemented** |
| 04 | Exchange Flows & Liquidity | **Implemented** |
| 05 | Whale Activity | Planned |
| 06 | Market Sentiment (Composite F&G) | **Implemented** (expert consensus disabled until ~2026-04-02) |
| 07 | HTF Technical Structure | **Implemented** |
| 08 | LTF Technical Structure | Planned |
| 09 | Macro Environment | Planned |
| 10 | Geopolitics & News | Planned |
| 11 | Cross-Market Correlations | Planned |
| 12 | Prediction Markets | Planned |
| 13 | Stablecoin Flows | Planned |
| 14 | DeFi Activity | Planned |
| 15 | Token Unlocks & Supply Events | Planned |
| 16 | BTC Mining Activity | Planned |
| 17 | ETH Staking & Network Activity | Planned |
| 18 | Equities Market Structure | Planned |

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
- An **LLM agent** (Claude 3.5 Sonnet, cached 24h by content-hash fingerprint) that interprets what the data means in context

## Pipeline Execution

The orchestrator runs all 5 implemented dimensions in parallel per asset:

```
Collector (fetch raw data)
    ↓
Analyzer (compute metrics, classify regime)
    ↓
Agent (Claude — cached 24h)
    ↓
Store state (JSON + DB)
```

State is persisted to both JSON files (`data/{dimension}_state.json`, keyed by asset) and PostgreSQL via Prisma.

## Data Structure Model

### State machine + multi-timeframe context

Dimensions use a **state machine** model instead of raw time-series. The deterministic analyzer maintains a current regime state and logs transitions.

Multi-timeframe context (percentiles over 1m/3m windows) lets the agent judge _scale_ — "funding at 0.045 feels high but is only 61st percentile over 3 months" — without needing raw historical data in the prompt.

Timeframe windows are computed from CoinGlass historical endpoints (30d–90d resolution) and updated incrementally.

---

## 01 — Derivatives Structure ✅

**What it watches:** Funding rates, open interest, liquidations, Coinbase premium

**Why it matters:** Shows leverage buildup, crowding, and positioning. Funding extremes precede reversals. OI divergence from price signals new position building. Liquidation cascades accelerate moves.

**Data model:** Two independent classifiers (positioning + stress) with an orthogonal OI signal modifier. This replaces the single-regime model from the original design — separating "who is positioned" from "what's happening to them" produces cleaner signals.

### Positioning classifier (structural, slow-moving)

Captures who is crowded/trapped.

**States:** `POSITIONING_NEUTRAL` · `HEATING_UP` · `CROWDED_LONG` · `CROWDED_SHORT`

**Transition rules (with hysteresis):**

- funding percentile(1m) > 80 + OI elevated → `CROWDED_LONG` (exit threshold: 75)
- funding percentile(1m) < 20 + OI elevated → `CROWDED_SHORT` (exit threshold: 25)
- funding percentile(1m) 40–70 + OI change(7d) > +2% → `HEATING_UP`
- All transitions require ≥2 confirming signals

### Stress classifier (event-driven, fast)

Captures what's happening to positioning. Evaluated in strict priority order:

**States (priority-ordered):** `CAPITULATION` > `UNWINDING` > `DELEVERAGING` > `STRESS_NONE`

**Transition rules:**

1. `CAPITULATION` — liquidation percentile(3m) > 85–90 + 2+ of: extreme liquidation spike, OI drop ≥ -10%, price move ≥ 5%
2. `UNWINDING` — OI change(24h) ≤ -3% to -5% AND liquidation percentile(1m) > 60–70
3. `DELEVERAGING` — 2–3+ negative funding cycles + gradual OI decline + no extreme liquidation spike
4. `STRESS_NONE` — default

### OI signal (orthogonal modifier)

**States:** `EXTREME` · `ELEVATED` · `OI_NORMAL` · `DEPRESSED`

- OI percentile(1m) > 90 → `EXTREME`
- OI percentile(1m) > 70 → `ELEVATED`
- OI percentile(1m) 30–70 → `OI_NORMAL`
- OI percentile(1m) < 30 → `DEPRESSED`

**Source:** CoinGlass API v4 — funding rates (current + 30d history at 8h resolution), OI history (30d at 4h resolution), aggregated liquidation history (90d at 8h resolution), Coinbase premium index (30d at 4h resolution)

**Source (planned, not yet implemented):** Hydromancer Reservoir — wallet-level Hyperliquid position snapshots, tick-level fills and liquidations, leverage distribution. Would enrich CoinGlass aggregates with granular on-chain data.

---

## 02 — Options & Implied Volatility 🔲

> **Status: Planned — not yet implemented**

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

## 03 — Institutional Flows (ETFs) ✅

**What it watches:** Daily net flows for BTC and ETH spot ETFs, GBTC premium/discount, total AUM

**Why it matters:** Direct measure of institutional demand. Multi-day flow trends signal conviction shifts. Grayscale premium/discount reflects arbitrage and sentiment.

**Data model:** State machine with streak-based regime detection and reversal logic. Collected daily with 1h cache TTL.

**Regime states:**
`STRONG_INFLOW` · `STRONG_OUTFLOW` · `REVERSAL_TO_INFLOW` · `REVERSAL_TO_OUTFLOW` · `ETF_NEUTRAL` · `MIXED`

**Transition rules (deterministic):**

- 3+ consecutive inflow days → `STRONG_INFLOW`
- 3+ consecutive outflow days → `STRONG_OUTFLOW`
- 2+ inflow days after outflow phase + reversal magnitude ≥ 20% of prior streak → `REVERSAL_TO_INFLOW`
- 2+ outflow days after inflow phase + reversal magnitude ≥ 20% of prior streak → `REVERSAL_TO_OUTFLOW`
- Mixed/no clear pattern → `ETF_NEUTRAL`

**Key metrics computed:**

- Consecutive inflow/outflow day count
- 7-day & 30-day cumulative flow
- Flow volatility (σ from 30d mean)
- Reversal ratio (current streak magnitude / prior opposite streak magnitude)
- GBTC premium/discount tracking

**Events:**

- `sigma_inflow` / `sigma_outflow` — single-day flow > 2σ from 30d mean
- `gbtc_premium` / `gbtc_discount` — GBTC at ± 3% premium/discount

**Source:** CoinGlass API v4 — BTC ETF flow history, BTC ETF list (AUM), GBTC holdings/premiums, ETH ETF flow history, ETH ETF net assets history

---

## 04 — Exchange Flows & Liquidity ✅

**What it watches:** Exchange balances (aggregate + per-exchange), net deposits/withdrawals, reserve changes over 1d/7d/30d

**Why it matters:** Coins moving off exchanges = accumulation (less sell pressure). Coins moving onto exchanges = distribution (preparing to sell). Long-term trends in exchange reserves are one of the most reliable on-chain signals.

**Data model:** State machine with statistical context. Collected with 1h cache TTL.

**Regime states:**
`ACCUMULATION` · `DISTRIBUTION` · `EF_NEUTRAL` · `HEAVY_INFLOW` · `HEAVY_OUTFLOW`

**Transition rules (deterministic, priority-ordered):**

1. daily flow ≥ 95th percentile(1m) + ≥ 2σ → `HEAVY_INFLOW`
2. daily flow ≤ 5th percentile(1m) + ≤ -2σ → `HEAVY_OUTFLOW`
3. 7d net outflow + balance trend falling → `ACCUMULATION`
4. 7d net inflow + balance trend rising → `DISTRIBUTION`
5. 30d low + 30d net outflow → `ACCUMULATION` (strengthened)
6. 30d high + 30d net inflow → `DISTRIBUTION` (strengthened)
7. default → `EF_NEUTRAL`

**Key metrics computed:**

- Net flow over 1d, 7d, 30d (derived from balance deltas)
- Reserve change % over 1d, 7d, 30d
- Daily flow mean, σ, and today's σ-score (vs 30d distribution)
- Flow percentile (1m)
- Balance trend direction (rising/falling/flat)
- 30d extreme detection (low/high)
- Top 5 exchanges by balance with 7d change

**Events:**

- `heavy_inflow` / `heavy_outflow` — daily balance change > 2σ from 30d mean
- `reserve_low` / `reserve_high` — total balance at 30d low/high

**Source:** CoinGlass API v4 — `/api/exchange/balance/chart` (historical balance + price per exchange), `/api/exchange/balance/list` (current balances with 1d/7d/30d % changes)

---

## 05 — Whale Activity 🔲

> **Status: Planned — not yet implemented**

**What it watches:** Large transactions (>$1M), whale accumulation/distribution patterns, notable address movements

**Why it matters:** Whales move markets. Tracking large transfers to/from exchanges signals intent. Accumulation by known smart money addresses is a leading indicator.

**Key signals:**

- Cluster of large exchange inflows → selling pressure ahead
- Whale accumulation during fear → smart money buying
- Dormant wallet activation → long-term holder decision point

**Source:** CoinGlass — whale transfers, large order tracking, Hyperliquid whale positions

**Source (planned):** Hydromancer Reservoir — daily position snapshots, account values, builder/TWAP fills

---

## 06 — Market Sentiment (Composite Fear & Greed) ✅

**What it watches:** Composite Fear & Greed index computed from five active components — derivatives positioning (Dim 01, 37.5%), institutional flows (Dim 03, 20%), exchange flows (Dim 04, 17.5%), HTF trend (Dim 07, 15%), and momentum divergence (Dim 07, 10%). Expert consensus (unbias API) is integrated but currently disabled while collecting delta-based data (~re-enable 2026-04-02). ATR volatility compression is excluded from the composite (it measures trade setup potential, not sentiment) but remains available as contextual data for the LLM synthesizer.

**Why it matters:** Traditional Fear & Greed indices (Alternative.me, CNN) use opaque methodology and produce unreliable readings — during testing, Alternative.me showed 14 (Extreme Fear) while actual market conditions (derivatives, trend, expert consensus) all indicated neutral-to-mild-greed territory. Our composite uses crypto-native inputs we control and understand.

**Data model:** State machine driven by composite score (0–100). Collected 3x/day (aligns with brief schedule).

**Component weights (current):**

| Component | Weight | Source | What it measures |
|-----------|--------|--------|-----------------|
| Positioning | 35% | Dim 01 (derivatives) | Funding percentile (35%), Coinbase premium percentile (25%), OI percentile (25%), bias-adjusted liquidations (15%) |
| Institutional flows | 20% | Dim 03 (ETF flows) | Flow streaks, σ magnitude, regime |
| Exchange flows | 15% | Dim 04 (exchange flows) | Reserve change direction, balance trend, 30d extremes, regime |
| Trend | 15% | Dim 07 (HTF technicals) | Price vs 50/200 SMA, RSI, market structure |
| Momentum divergence | 10% | Dim 07 (HTF technicals) | Price-RSI divergence + CVD divergence |
| Volatility compression | 5% | Dim 07 (HTF technicals) | ATR compression/expansion |
| Expert consensus | 0% | unbias API | **Disabled** — collecting delta-based data, re-enable ~2026-04-02 |

**Regime states:**
`EXTREME_FEAR` · `FEAR` · `SENTIMENT_NEUTRAL` · `GREED` · `EXTREME_GREED` · `CONSENSUS_BULLISH` · `CONSENSUS_BEARISH` · `SENTIMENT_DIVERGENCE`

**Transition rules (deterministic):**

- composite < 20 → `EXTREME_FEAR`
- composite 20–40 → `FEAR`
- composite 40–60 → `SENTIMENT_NEUTRAL`
- composite 60–80 → `GREED`
- composite > 80 → `EXTREME_GREED`
- _(Disabled)_ unbias z-score ≥ +0.8 + composite > 70 → `CONSENSUS_BULLISH`
- _(Disabled)_ unbias z-score ≤ -1.5 + composite < 30 → `CONSENSUS_BEARISH`
- _(Disabled)_ unbias z-score ≥ +0.8 + composite < 30, or z-score ≤ -1.5 + composite > 70 → `SENTIMENT_DIVERGENCE`

**Source:** Cross-dimension data from Dims 01, 03, 07. unbias API (analyst consensus — free tier: 100 req/day, daily granularity, currently disabled).

**unbias API details:**

| Endpoint | Data | Use |
|----------|------|-----|
| `GET /api/v1/consensus` | Consensus index (-100 to +100), 30d MA, 90d z-score, bullish/bearish analyst counts | Expert sentiment per asset (BTC, ETH, ALL) |
| `GET /api/v1/sentiment` | Per-analyst sentiment scores (0–1), filterable by handle | Drill-down: which analysts are driving consensus shifts |

Auth: `X-API-Key` header. Free tier: 100 req/day, daily granularity, current data only. Pro ($49/mo): 1000 req/min, hourly granularity, full history.

---

## 07 — HTF Technical Structure ✅

**What it watches:** 4H and daily chart structure — moving averages (50/200 SMA on 4H), RSI (14-period on daily + 4H), market structure (HH/HL/LH/LL), CVD (cumulative volume delta) with dual-window analysis, VWAP (weekly + monthly anchored), ATR (14-period on 4H)

**Why it matters:** Defines the macro regime. Are we in a trend or range? Where are the structural levels that matter? HTF structure overrides LTF noise. CVD adds volume-conviction context that pure price structure misses.

**Data model:** State machine with 8 regime states. Collected with 1h/4h cache TTL.

**Regime states:**
`MACRO_BULLISH` · `BULL_EXTENDED` · `MACRO_BEARISH` · `BEAR_EXTENDED` · `RECLAIMING` · `RANGING` · `ACCUMULATION` · `DISTRIBUTION`

**Transition rules (deterministic):**

- price > 200 SMA + daily RSI ≤ 70 → `MACRO_BULLISH`
- price > 200 SMA + daily RSI > 70 → `BULL_EXTENDED`
- 50 SMA < price < 200 SMA → `RECLAIMING`
- price < both SMAs + daily RSI < 30 → `BEAR_EXTENDED`
- price < both SMAs + structure LH_LL → `MACRO_BEARISH`
- price < both SMAs + futures CVD long-window rising → `ACCUMULATION`
- price < both SMAs + futures CVD long-window declining → `DISTRIBUTION`
- price < both SMAs (default) → `RANGING`

**Technical indicators computed:**

- **SMAs:** 50 & 200-period on 4H candles (300 candle history)
- **RSI-14:** Daily (trend bias, 104 candle history) + 4H (momentum)
- **CVD (Cumulative Volume Delta):** Dual-window analysis on futures
  - Short window: 20 candles (~3.3 days) — catches regime turns early
  - Long window: 75 candles (~12.5 days) — confirms swing holds
  - Divergence: price-CVD disagreement (bullish = accumulation, bearish = distribution)
  - Thresholds: slope 0.02, R² 0.3
- **Market structure:** HH_HL (bullish) · LH_LL (bearish) · HH_LL (expanding) · LH_HL (contracting) · STRUCTURE_UNKNOWN
- **VWAP:** Weekly & monthly anchored
- **ATR-14:** Execution-timeframe volatility (4H)
- **MA crosses:** Golden (50 > 200) / Death (50 < 200) / None

**Events tracked:**

- Golden/death crosses, 200 SMA reclaim/break, RSI extremes, structure shifts, CVD divergence

**Source:** Binance spot public API (300 4H candles + 104 daily candles), Binance futures public API (300 4H candles for CVD)

---

## 08 — LTF Technical Structure 🔲

> **Status: Planned — not yet implemented**

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

## 09 — Macro Environment 🔲

> **Status: Planned — not yet implemented**

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

## 10 — Geopolitics & News 🔲

> **Status: Planned — not yet implemented**

**What it watches:** Breaking news, regulatory developments, exchange incidents, protocol events, geopolitical risk events

**Why it matters:** News catalysts create volatility and shift narratives. Regulatory news (SEC, EU) can move markets for days. Distinguishing noise from signal is the agent's main job here.

**Key signals:**

- Regulatory action (SEC suit, ban, approval) → high impact
- Exchange hack/insolvency → contagion risk
- War/sanctions escalation → risk-off
- Major protocol upgrade/incident → asset-specific

**Source:** CryptoPanic (aggregated news + sentiment votes — free tier), CryptoCompare

---

## 11 — Cross-Market Correlations 🔲

> **Status: Planned — not yet implemented**

**What it watches:** BTC correlation with SPX, Nasdaq, gold, DXY, bonds. Relative performance of crypto vs traditional risk assets.

**Why it matters:** When correlations are high, crypto follows macro. When they decouple, crypto is trading on its own narrative. Correlation regime itself is a signal — high correlation = macro-driven, low correlation = crypto-native drivers.

**Key signals:**

- BTC-SPX 30d correlation > 0.7 → macro-driven regime
- BTC-SPX correlation breaking down → narrative shift
- BTC-gold correlation rising → "digital gold" trade active
- Crypto outperforming during equity selloff → strength signal

**Source:** CCXT (crypto prices), FRED/Yahoo Finance (SPX, gold, DXY, bond yields)

---

## 12 — Prediction Markets 🔲

> **Status: Planned — not yet implemented**

**What it watches:** Crypto-relevant prediction market odds — price targets, ETF approvals, regulatory outcomes, election impacts on crypto policy

**Why it matters:** Prediction markets aggregate informed opinion with real money at stake. Rapid probability shifts reveal changing consensus before it shows up in price.

**Key signals:**

- Price target probability dropping >15% in 48h → conviction weakening
- Regulatory outcome odds shifting → front-run the narrative
- High-confidence market (>85%) → priced in, move on news unlikely
- New high-volume market created → emerging narrative

**Source:** Polymarket API (free, no auth for read-only). [Docs](https://docs.polymarket.com/api-reference/introduction)

---

## 13 — Stablecoin Flows 🔲

> **Status: Planned — not yet implemented**

**What it watches:** USDT/USDC circulating supply, mint/burn events, market cap changes, per-chain distribution, stablecoin dominance

**Why it matters:** Stablecoin minting = new capital entering crypto. Burning = capital exiting. Stablecoin dominance rising = risk-off rotation within crypto. These are the "dry powder" and "exit" signals.

**Key signals:**

- Large USDT/USDC mint (>$500M) → capital inflow, bullish
- Stablecoin dominance rising + price falling → flight to safety
- Stablecoin supply on exchanges rising → buying power accumulating
- USDC/USDT ratio shifting → regional flow indicator (US vs offshore)

**Source:** DefiLlama stablecoins API (free — supply, mint/burn, per-chain breakdown)

---

## 14 — DeFi Activity 🔲

> **Status: Planned — not yet implemented**

**What it watches:** Total TVL, TVL by chain, DEX vs CEX volume ratio, protocol-level TVL shifts, yield trends

**Why it matters:** TVL reflects capital commitment to on-chain ecosystems. DEX volume spikes during volatility. TVL migration between chains signals narrative rotation. Yield compression/expansion reflects risk appetite.

**Key signals:**

- TVL dropping while price stable → capital leaving, bearish divergence
- DEX/CEX volume ratio spiking → on-chain activity surge (often during fear)
- TVL rotating to new chain → emerging narrative
- Yield compression across DeFi → risk appetite low

**Source:** DefiLlama (free — TVL, DEX volumes, protocol data)

---

## 15 — Token Unlocks & Supply Events 🔲

> **Status: Planned — not yet implemented**

**What it watches:** Upcoming token unlock schedules, vesting cliff events, large supply expansions, emission rate changes

**Why it matters:** Supply shocks move prices. A large unlock (>2% of circulating supply) creates sell pressure as investors/team take profit. Markets often front-run unlocks by days.

**Key signals:**

- Unlock > 2% of circulating supply within 7 days → sell pressure risk
- Cliff unlock (vs linear) → concentrated impact
- Multiple large unlocks across assets in same week → sector-wide pressure
- Post-unlock price stability → absorbed, bullish

**Source:** CoinGlass (token unlocks/vesting schedules)

---

## 16 — BTC Mining Activity (BTC only) 🔲

> **Status: Planned — not yet implemented**

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

## 17 — ETH Staking & Network Activity (ETH only) 🔲

> **Status: Planned — not yet implemented**

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

## 18 — Equities Market Structure 🔲

> **Status: Planned — not yet implemented**

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

**Relationship to other dimensions:**

- **Dimension 09 (Macro):** Macro tracks policy inputs; this tracks market outputs. Fed can be dovish while equities break down (and vice versa).
- **Dimension 11 (Cross-Market Correlations):** Correlations tell you _how linked_ crypto is to equities; this tells you _what equities are actually doing_. Both matter.

**Source:** FRED API (free — VIX via CBOE, S&P 500, advance/decline), Yahoo Finance (sector ETFs, breadth data, moving averages), CBOE (put/call ratio)

---

## Data Source Summary

### Currently active

| Source | Dimensions | Cost | Auth | Details |
|--------|-----------|------|------|---------|
| CoinGlass API v4 | 01, 03 | $29/mo (Hobbyist) | API key | Funding rates, OI, liquidations, Coinbase premium, ETF flows, GBTC |
| Binance spot (public) | 07 | Free | None | 4H + daily OHLCV candles |
| Binance futures (public) | 07 | Free | None | 4H candles for CVD analysis |
| unbias | 06 | Free (100 req/day) | API key | Currently disabled, collecting delta data |

**Total active data cost: ~$29/mo** (CoinGlass only paid source)

### Planned (for future dimensions)

| Source | Planned Dimensions | Cost | Auth |
|--------|-------------------|------|------|
| CoinGlass | 02, 04, 05, 08, 15, 16 | (already paying) | API key |
| Glassnode | 16, 17 | Free (Standard) | API key |
| CCXT | 08, 11 | Free | Per-exchange keys |
| CryptoPanic | 10 | Free tier | API token |
| CryptoCompare | 10 | Free tier | API key |
| FRED | 09, 11, 18 | Free | API key |
| Polymarket | 12 | Free | None |
| DefiLlama | 13, 14, 17 | Free | None |
| Yahoo Finance | 11, 18 | Free | None |
| CBOE | 18 | Free | None |
| Hydromancer Reservoir | 01, 05 | Free (S3 requester-pays) | None |

### Hydromancer Reservoir (planned, not yet integrated)

S3-based data warehouse for Hyperliquid historical data. Not a REST API — data is stored as Parquet files queryable via DuckDB.

**Bucket:** `s3://hydromancer-reservoir` (requester-pays, region `ap-northeast-1`)
**Data available from:** 2025-07-28 (complete data from this date onward)
**Update frequency:** Daily
**Known gap:** Late October to mid-December 2025 snapshot data missing (ABCI state capture gap)

**Datasets available:**

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
