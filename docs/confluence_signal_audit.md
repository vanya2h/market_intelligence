# Confluence Signal Audit — Reversal Detection

**Goal:** Identify the moment when price has made a big move, compressed into a coiled spring, and is ready to reverse. Every scoring component must answer: *does this signal confirm that the crowd is positioned wrong and a spring is loaded?*

## What to keep and remove

### DERIVATIVES

| Component | Decision | Reason |
|---|---|---|
| CROWDED_SHORT / CROWDED_LONG | KEEP | Core reversal fuel — crowd built up during the prior move, they are wrong |
| HEATING_UP | REMOVE | Crowd is building a position but not committed yet. Fires during the compression phase itself and adds directional ambiguity |
| CAPITULATION / UNWINDING stress | KEEP | These are the violent displacement events that precede compression |
| DELEVERAGING stress | REMOVE | Mild signal (10–30 pts). 3+ funding cycles without a real event is noise |
| Funding extremes (> 80 / < 20 pct) | KEEP | Over-leveraged crowd in one direction |
| OI multiplier | KEEP | More OI = more fuel for squeeze |

### ETFs

| Component | Decision | Reason |
|---|---|---|
| Flow sigma + regime-contradiction bonus | KEEP | Big inflow during outflow regime = institutional reversal |
| Reversal confirmation (2+ days after streak) | KEEP | The reversal confirmation signal |
| Streak exhaustion | REMOVE | Fires mid-streak (day 3 of outflows). Weak and pre-confirmation — streaks last much longer than expected |
| Regime REVERSAL_TO_INFLOW / REVERSAL_TO_OUTFLOW | KEEP | Regime classified the inflection as real |
| Regime STRONG_INFLOW / STRONG_OUTFLOW | REMOVE | Trend-following signal, not a reversal signal. STRONG_INFLOW = entering mid-trend. We want the end of STRONG_OUTFLOW, not the middle of STRONG_INFLOW |
| Reversal ratio | KEEP | Measures how far the reversal has already progressed |

### HTF

| Component | Decision | Reason |
|---|---|---|
| RSI (4h + daily) | KEEP | RSI stretched by the prior move = mean-reversion fuel |
| CVD divergence (futures + spot) | KEEP | Selling into declining price = absorption/exhaustion = reversal signal |
| Volatility compression | KEEP | The core signal — ATR compressed after displacement = spring loaded |
| Volume Profile (price vs POC) | KEEP | Displaced price = magnetic pull back to fair value |
| Regime score (price vs SMA200) | REMOVE + REPLACE | Actively harmful: returns -17 when price is below SMA200, penalizing LONG exactly when price has been sold down. Being below the MA after a sell-off IS the setup. Replace with MA displacement score — further below = stronger LONG pull (inverted sign) |
| Market structure (HH_HL, LH_HL etc) | REMOVE | LH_HL scores -10 for LONG but LH_HL is a tightening compression pattern — the textbook pre-breakout formation. Scoring is backwards for reversals |
| Sweep proximity | REMOVE | ±15 noise. A nearby liquidity level does not indicate a spring is loaded |
| Thin ice bonus | REMOVE | Only fires for SHORT (penalizes breakdowns at MAs). Not a reversal concept |

**Replacement for regime score:** MA displacement — the further price is below SMA50/200, the stronger the LONG pull. Sign is opposite to current implementation (below MA = bullish, above = bearish).

### SENTIMENT

Remove entirely from confluence scoring.

The composite F&G is computed as: 50% derivatives (funding, OI, CB premium, liquidations) + 30% ETF flows + 20% HTF (SMA200, SMA50, RSI, structure). Including it in confluence alongside those three dimensions is pure triple-counting — every signal it carries is already measured directly by its source dimensions with better granularity.

Sentiment still has value as a narrative/context layer for the LLM synthesizer (crowd temperature), but it should not contribute a score to the mechanical confluence total.

### EXCHANGE FLOWS

| Component | Decision | Reason |
|---|---|---|
| Reserve change 7d / 30d | KEEP | Sustained accumulation during a sell-off = bullish divergence, smart money signal |
| Flow sigma (today) | REMOVE | Noisy single-day event, already captured by the 7d reserve trend |
| Balance trend (FALLING/RISING) | REMOVE | Redundant with reserveChange7dPct — same signal counted twice |
| 30d extremes | KEEP | Reserves at 30d low = maximum displacement = structural accumulation |
| Exchange-level divergence (retail inflows + spot outflows) | REMOVE | Wrong context: designed to detect distribution during an up-move. For a reversal from a sell-off it has nothing to say, and currently fires as -20 to -40 penalty on LONG |

---

## Summary

### Remove entirely
- **Sentiment dimension** from confluence scoring (triple-counting of derivatives + ETFs + HTF)

### Remove (11 components across remaining dimensions)
1. HEATING_UP derivatives positioning
2. DELEVERAGING stress
3. ETF streak exhaustion
4. ETF STRONG_INFLOW / STRONG_OUTFLOW regime base (keep REVERSAL_TO_* only)
5. HTF regime score (price vs SMA200)
6. HTF market structure (HH_HL / LH_HL etc)
7. HTF sweep proximity
8. HTF thin ice
9. Exchange flows sigma
10. Exchange flows balance trend
11. Exchange flows exchange-level divergence

### Replace (1 component)
- HTF regime score → **MA displacement**: `price below SMA = LONG pull`, `price above SMA = SHORT pull` (inverted sign from current)

### Weight redistribution
After removing sentiment and noisy components, weights redistribute across 4 dimensions only (derivatives, ETFs, HTF, exchange flows):
- HTF: compression > CVD > RSI > VP > MA displacement
- ETF: sigma + reversal confirm > reversal ratio > reversal regime
- Exchange flows: reserve 7d/30d > 30d extreme

---

## Why the 200 threshold is broken for this setup

Compression setups have **neutral derivatives by definition** — positioning heated up and cooled off during the prior move. Without CROWDED_SHORT/LONG, the other four dimensions max out at ~156 even in a perfect scenario. The threshold of 200 implicitly requires derivatives to be crowded, which makes it unreachable for coiled spring setups.

After the signal audit reduces noise components and refocuses weights, the max realistic score for a compression setup (no crowded derivatives) rises significantly. The compression-aware threshold (`computeConvictionThreshold`) was added as a first step (130 at ATR 2nd pct), but the weight changes will be the real fix.
