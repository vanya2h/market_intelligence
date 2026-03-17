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

---

## 06 — Market Sentiment

**What it watches:** Fear & Greed index, social sentiment aggregates, consensus/bias indicators, crowd positioning

**Why it matters:** Extreme sentiment is contrarian signal. When everyone agrees, the move is usually over. Fear & Greed extremes historically precede reversals.

**Key signals:**

- F&G < 20 (extreme fear) → historically good entry zone
- F&G > 80 (extreme greed) → historically overheated
- Rapid sentiment shift (>30 points in 48h) → notable event
- Unanimous bullish/bearish consensus → contrarian warning

**Source:** Alternative.me (F&G index — free), CryptoPanic (news sentiment voting)

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

## Data Source Summary

| Source         | Dimensions Covered                    | Cost              | Auth              |
| -------------- | ------------------------------------- | ----------------- | ----------------- |
| CoinGlass      | 01, 02, 03, 04, 05, 07, 08, 15, 16   | $29/mo (Hobbyist) | API key           |
| Glassnode      | 16, 17                                | Free (Standard)   | API key           |
| CCXT           | 07, 08, 11                            | Free              | Per-exchange keys |
| Alternative.me | 06                                    | Free              | None              |
| CryptoPanic    | 06, 10                                | Free tier         | API token         |
| CryptoCompare  | 10                                    | Free tier         | API key           |
| FRED           | 09, 11                                | Free              | API key           |
| Polymarket     | 12                                    | Free              | None              |
| DefiLlama      | 13, 14, 17                            | Free              | None              |

**Total data cost: ~$29/mo** (CoinGlass only paid source)
