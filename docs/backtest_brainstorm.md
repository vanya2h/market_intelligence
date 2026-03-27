# Backtest & Model Validation Brainstorm

How to measure accuracy of the swing trading model as data accumulates day by day.

---

## 1. Trade Idea Tracking (most direct)

Each brief produces a **TRADE IDEA** with direction, entry level, and invalidation level. Log these structured fields and track outcomes:

- **Win rate**: Did price reach the target before invalidation?
- **Risk/reward realized**: How far did price move in the predicted direction vs. the invalidation distance?
- **Time-to-target**: How many hours/days until the move played out (or failed)?

**Implementation**: Add a `trade_ideas` table with columns: `asset, direction, entry, target, invalidation, timestamp, outcome, outcome_timestamp`. A daily cron job checks if open ideas hit target or invalidation using Binance candle data.

---

## 2. Regime Transition Accuracy

The most valuable signal for swing trading is **regime transitions** (e.g., `CROWDED_LONG → UNWINDING`, `BEAR_EXTENDED → RECLAIMING`). Track:

- **Forward returns after regime change**: What's the 1d/3d/7d/14d return after each transition?
- **Regime duration vs. return**: Do longer regimes produce larger reversal moves when they finally flip?
- **False transitions**: How often does a regime flip back within 24h (noise vs. signal)?

**Implementation**: We already store `regime`, `since`, `previousRegime`, `durationHours` in dimension state. Add a `regime_transitions` table that logs each flip with the price at transition time, then compute forward returns.

---

## 3. Confluence Score Backtesting

The system's edge is **cross-dimension agreement**. Test whether confluence predicts better outcomes:

- When 3/4 dimensions agree on direction → what's the hit rate?
- When only 1/4 agrees → does it underperform?
- **Conviction calibration**: Are "HIGH CONVICTION" briefs actually more accurate than "MODERATE" ones?

**Implementation**: For each brief, compute a numeric confluence score (count of dimensions pointing same direction). Correlate with forward returns.

---

## 4. Fear & Greed Extremes as Reversal Signals

The composite sentiment index (0–100) is designed to catch extremes. Classic test:

- **Buy when EXTREME_FEAR, sell when EXTREME_GREED**: What's the N-day forward return at each level?
- **Percentile buckets**: Bin composite scores into deciles, plot average forward returns — should show a curve.
- **Time-in-extreme**: Does staying in EXTREME_FEAR for 3+ days predict stronger reversals than a 1-day spike?

**Implementation**: Query `brief_sentiment` history, join with price data at `brief_htf.snapshotPrice`, compute returns.

---

## 5. Signal Staleness Decay Analysis

We track `SignalStaleness` (candles since RSI extreme, CVD peak, etc.). Measure:

- Do **fresh signals** (staleness < 3 candles) produce better outcomes than stale ones (> 10)?
- What's the optimal "act within N candles" window for each signal type?

---

## 6. Paper Trading Portfolio Simulation

Run a simple rules-based strategy on top of the model output:

- Enter when confluence ≥ 3 dimensions + EXTREME sentiment + regime just flipped
- Size by conviction level
- Exit at invalidation or target
- Track equity curve, max drawdown, Sharpe ratio

This doesn't need to be a real strategy — it's a **scoring function** for the model's signal quality.

---

## 7. Prediction Journaling with LLM Self-Evaluation

Since the orchestrator already produces structured briefs, add a **retrospective agent**:

- Every 3 days, feed the agent the brief from 3 days ago + what actually happened (price, regime changes)
- Agent scores its own prediction: `{ accuracy: 0-10, what_it_got_right, what_it_missed, why }`
- Accumulate these self-evaluations to spot systematic biases (e.g., "consistently too early on reversals")

---

## 8. Baseline Comparisons

To know if the model adds value, compare against naive baselines:

- **Random entry**: Same holding period, random direction
- **SMA crossover only**: Just use the 50/200 SMA without other dimensions
- **Buy-and-hold**: Over the same period
- **Funding rate only**: Just trade funding extremes without confluence

If the full model doesn't beat these, the complexity isn't justified.

---

## 9. Dimension Attribution (Shapley-style)

Which dimension contributes most to correct predictions?

- For each correct trade idea, check which dimensions agreed
- Run ablation: what's the hit rate if you remove derivatives? Remove sentiment?
- This tells you which data sources are earning their keep

---

## 10. Daily Snapshot Drift Monitor

Track metric distributions over time to detect **data drift**:

- Is funding rate distribution shifting? (CoinGlass API behavior change?)
- Are ETF flow magnitudes growing? (thresholds may need recalibration)
- Is RSI spending more time mid-range? (ranging market makes reversal signals noisy)

---

## Priority Matrix

| Priority | Idea | Effort | Value |
|----------|------|--------|-------|
| **P0** | Trade idea tracking (#1) | Medium | Direct accuracy measurement |
| **P0** | Regime transition forward returns (#2) | Low | Uses existing data |
| **P1** | Confluence score backtesting (#3) | Low | Tests core thesis |
| **P1** | F&G extreme returns (#4) | Low | Uses existing data |
| **P2** | LLM retrospective (#7) | Medium | Catches systematic bias |
| **P2** | Baseline comparisons (#8) | Medium | Validates model adds value |
| **P3** | Paper trading simulation (#6) | High | Full integration test |
| **P3** | Dimension attribution (#9) | Medium | Optimization insight |
