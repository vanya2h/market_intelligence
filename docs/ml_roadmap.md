## ML Roadmap

How machine learning replaces and extends the heuristic confluence scoring. **L1 is shipped** — the ONNX-backed logistic regression is the default aggregator, with the heuristic kept as a shadow value and a silent fallback. L2 is the next active step. L3 and L4 are captured here for later phases.

## Context: where weights live today

There are two layers of "weight management" in the pipeline. They have very different leverage.

1. **Cross-dimension aggregation** — was IC-weighted, now ML-driven. [`ml-aggregator.ts`](../packages/pipeline/src/orchestrator/trade-idea/ml-aggregator.ts) is the live aggregator. [`ic-weights.ts`](../packages/pipeline/src/orchestrator/trade-idea/ic-weights.ts) still runs but as **diagnostic infrastructure only**: it surfaces per-dim IC and `recentIc` to the API (`GET /trades/ic-weights/:asset`) and the [Signals panel](../packages/web/app/routes/signals.tsx) for regime-drift monitoring between ML retrains. It also still produces the heuristic `total` that lives alongside `mlTotal` for back-compat and as a shadow comparator.
2. **Intra-dimension scoring** — fully hand-tuned. The bulk of the brittleness lives here: dozens of magic numbers in [`confluence.ts`](../packages/pipeline/src/orchestrator/trade-idea/confluence.ts) (`DERIV_W_POSITIONING`, `ETF_W_SIGMA`, `EF_W_RESERVE`, funding decay τ, dead-zone widths, the `Math.pow(x, 0.65)` power curve, saturation thresholds, etc.). **Untouched by L1.** Replacing this is the L2 lift.

The L1 deployment confirmed the layer-2 hypothesis: ML on top of the existing per-dim scores beats the heuristic, but the per-dim scoring formulas themselves are where the regime-fragility lives.

---

## Shipped: Level 1 — Learned cross-dim aggregator

### Implementation

| | |
|---|---|
| **Training** | Python (`packages/pipeline/training/train.py`) — sklearn `LogisticRegression` (L2, `class_weight='balanced'`), walk-forward CV via `TimeSeriesSplit`, exports ONNX + `.meta.json` |
| **Inference** | Node ([`ml-aggregator.ts`](../packages/pipeline/src/orchestrator/trade-idea/ml-aggregator.ts)) via `onnxruntime-node`, lazy session cache |
| **Inputs** | The four per-dim scores already produced by [`confluence.ts:computeConfluence`](../packages/pipeline/src/orchestrator/trade-idea/confluence.ts) |
| **Output** | `P(win)` in `[0, 1]`, mapped to `mlTotal = 2*pWin - 1` in `[-1, +1]` to preserve the existing total contract |
| **Per-asset** | Separate BTC and ETH models — coefficient signs differ enough that pooling would hurt |
| **Failure policy** | Silent null fallback — missing model or inference error → warning logged, `mlTotal` undefined, `decisionScore()` returns the heuristic `total` |
| **Cache** | Successful loads only; failures are not cached, so retraining is picked up on the next brief without restart |
| **Artifacts** | `packages/pipeline/models/confluence_<asset>_<version>.{onnx,meta.json}`, checked into git |

The pipeline now persists **both** values per trade idea:

- `confluence.total` — IC-weighted heuristic. Always present.
- `confluence.mlTotal?` — ML output. Set when the model ran successfully.

`decisionScore(c) = c.mlTotal ?? c.total` is the single source of truth used for direction selection, sizing, bias, and composite-target computation. Old code that reads `total` continues to work; the heuristic is preserved as an audit trail and shadow comparator. See the [training README](../packages/pipeline/training/README.md) for the retraining workflow.

### Findings from the first 37 days of data

Surfaced once we could compare the trained model against the live heuristic over the same 241 BTC / 230 ETH resolved trade ideas:

**Stored heuristic (the IC-weighted total used at trade time)**
- BTC: 40.2% accuracy, Brier 0.297 — *worse than always predicting "loss"* (56.8% baseline against a 137L/104W class split).
- ETH: 48.7% accuracy, Brier 0.259.

**Per-dim Pearson IC (signed correlation between dim score and outcome)**

| Dimension | BTC IC | ETH IC |
|---|---|---|
| derivatives | -0.05 | +0.08 |
| etfs | +0.05 | -0.16 |
| **htf** | **-0.21** | **-0.23** |
| exchangeFlows | +0.18 | +0.15 |

- **HTF is the most anti-predictive dimension on both assets, by a wide margin.** Two independent samples agreeing makes this unlikely to be regime noise — it points at the HTF scoring logic itself (or its tuning) being misaligned with outcomes over the last 37 days.
- **ExchangeFlows is the most consistent positive signal on both assets.**
- ML walk-forward OOF accuracy: 50.5% BTC, 60.5% ETH — meaningfully better than the heuristic and structurally explains why: ML naturally learns negative coefficients for anti-predictive dims, while the IC weight floor of 0.0625 forces every dimension to contribute *with the wrong sign* even when its IC is negative.

These findings are also driving an HTF-analyzer review (separate work item, not strictly ML).

---

## Next: Level 2 — Learned model over raw sub-features (hybrid)

Skip the per-dim scoring functions entirely; feed the raw analyzer outputs into a single model.

- **Inputs:** `fundingPct1m`, `oiZScore30d`, `liqPct1m/3m`, `cbPremium.percentile`, `etf.todaySigma`, `reversalRatio`, `consecutiveInflowDays`, `rsi.h4`, `cvd.futures.divergence`, `reserveChange7dPct`, regime enums one-hot, and the existing per-dim scores as engineered features (don't throw away the priors). Roughly 30–60 features.
- **Model:** LightGBM / XGBoost with monotonic constraints where signs are known (more outflow → more bullish, etc.). ONNX export still works for these.
- **Target:** same as L1 — `sign(qualityAtPoint)` for classification, or `qualityAtPoint` regression.
- **Risk:** moderate. More features → more overfit risk → walk-forward CV is mandatory and currently has only ~37 days of history.
- **Wins:** removes the hand-tuned intra-dim formulas; captures non-linear interactions ("RSI overbought AND funding extreme") that the linear L1 aggregator can't.

The dimension collectors, analyzers, sizing, bias, and LLM synthesizer all stay unchanged. Only the **score-production step** changes — instead of `analyzer → per-dim score → ML aggregator`, it becomes `analyzer → ML model → mlTotal directly`. The per-dim scores can still be computed and persisted alongside as features and for UI display.

**Reuses everything from L1:** ONNX export, the inference module pattern (extend `ml-aggregator.ts` or add a sibling), failure policy, model versioning, training README workflow.

---

## Future work

### Level 3 — Time-series features

Today, every scoring call is a snapshot. The `DimensionSnapshot` table is a goldmine that's currently only read for charts, not training.

**Idea:** keep the model class from L2 (GBT), but engineer features that capture *trajectory* instead of point-in-time:

- 24h slope of OI z-score
- 5-day momentum of ETF sigma
- Funding-percentile change since regime entry
- Rolling correlation between BTC and ETH dimensions
- Time-since-last-extreme for each indicator
- Acceleration / deceleration of reserve drawdown

Most of the alpha in macro-style setups lives in trajectory features, not in static snapshots. This is likely where the largest performance jump beyond L2 comes from.

**Prerequisites:**
- Backfill a feature-engineering job that materializes rolling features from `DimensionSnapshot` history.
- Synthesize labels by walking historical snapshots forward N hours and computing `qualityAtPoint`-equivalents. This can multiply the training set 10–100× beyond resolved trade ideas.

**Risks:**
- Label leakage (a feature accidentally encodes future info). Audit each feature.
- Feature explosion → dimensionality penalty. Use feature selection or L1 regularization.

### Level 4 — End-to-end temporal model

A small 1D-CNN or transformer that takes raw indicator time series directly (no hand-engineered features) and outputs direction probability + magnitude + uncertainty.

**When to attempt:**
- ≥ 1000 resolved trade ideas, OR
- ≥ 5000 synthetic labels from historical snapshot walk-forward
- Stable feature schemas for ≥ 6 months (otherwise the model retrains on a moving target)

**Architecture sketch:**
- Input: `[T, F]` tensor — last T hours of F indicators.
- Embedding layer per indicator (handles different scales).
- 1D-CNN or small transformer encoder → pooled representation.
- Two heads:
  1. Direction head: P(LONG wins).
  2. Magnitude head: expected `qualityAtPoint`.
- Loss: cross-entropy + MSE, weighted.

**Risks:**
- Crypto regime shift will eat any model that doesn't have explicit recency weighting or online retraining.
- High variance — needs strong regularization (dropout, weight decay, early stopping).
- Black box — hard to debug a bad call. Pair with SHAP / integrated gradients for interpretability.
- Infra cost — GPU training + serving overhead vs LightGBM's negligible footprint.

**Likely only worth it if:**
- L3 has plateaued
- Dataset is large enough
- A pattern that's clearly temporal (sequence-dependent) is showing up in residuals

---

## Cross-cutting concerns (apply at every level)

### Label engineering

`qualityAtPoint = returnPct × exp(-hoursAfter/τ)` is the L1 target — direction-signed, time-decayed. Variants worth experimenting with at L2+:

- **Binary:** did price hit T1 before stop-loss? (matches actual trading outcome)
- **Multi-horizon:** predict 6h, 24h, 72h returns separately; ensemble.
- **Risk-adjusted:** divide by realized volatility over the window.

### Walk-forward CV

Random K-fold leaks future into past — fatal for time series.

✅ Train on Jan–Mar, test on Apr. Then train on Jan–Apr, test on May. Step forward each iteration.

L1 uses `sklearn.model_selection.TimeSeriesSplit` with up to 5 folds; this is the template for L2+.

### Calibration

Sizing maps conviction → position size. Model probabilities must be calibrated (Platt scaling or isotonic regression on the validation set), or sizing breaks silently.

**Status:** L1 currently uses raw `predict_proba` output without explicit calibration. Reliability diagrams haven't been generated yet — when they show miscalibration, add Platt/isotonic on a held-out fold before final fit. This is a known L1 follow-up.

### Regime drift

Crypto regimes shift — bull/bear/range. A static model trained on bull-market data underperforms in chop. Mitigations:

- Sample-recency weighting in training loss.
- Periodic retrain (weekly / monthly).
- Hold out a "regime-change" validation set explicitly (e.g., the most recent 3 months always).
- Online learning for L1 (logistic regression supports incremental updates trivially).

`recentIc` from [`ic-weights.ts`](../packages/pipeline/src/orchestrator/trade-idea/ic-weights.ts) is the live early-warning indicator — when a dim's recent IC diverges sharply from full-history IC, retrain. The Signals panel surfaces both.

### Hand-crafted features as priors

The current heuristics encode domain knowledge that's hard to recover from limited data — e.g., the funding-phase decay logic in [`confluence.ts:84-128`](../packages/pipeline/src/orchestrator/trade-idea/confluence.ts) ("fresh extreme = trend-following, decays to mean-reversion when exhaustion fires"). Don't throw these away; feed them as engineered features alongside the raw inputs. The model can then learn whether to trust them.

### Data inventory checklist

Before any L3/L4 work, audit:

- Number of resolved `TradeIdea` rows per asset (`pnpm ml:audit`).
- Number of `DimensionSnapshot` rows per dimension per asset, time range.
- Schema stability: how many of those snapshots have the *current* feature set vs older shapes.
- Distribution of outcomes (avoid training on a class-imbalanced set without resampling).

### Evaluation

Don't optimize raw accuracy. Optimize what actually matters:

- **Sharpe-equivalent:** mean(quality) / stddev(quality) over the test set.
- **Calibration:** reliability diagram — does P(win)=0.7 actually win 70% of the time?
- **Tail behavior:** worst 5% of trades — are they worse than the heuristic's worst 5%?
- **A/B vs heuristic:** L1 already supports this — `confluence.total` (heuristic) and `confluence.mlTotal` are persisted side by side on every new trade idea, so a backtest can compare both decisions over the same rows without re-running the pipeline.

---

## Current status & next steps

1. **L1 — shipped.** Default ML aggregator, shadow heuristic preserved, 4 features, 2 per-asset models. Retrain workflow documented at [`packages/pipeline/training/README.md`](../packages/pipeline/training/README.md).
2. **L1 follow-ups, in order of priority:**
   - **Investigate HTF analyzer** — strongest finding from L1 training; both assets show HTF as most anti-predictive. Likely a real bug or stale tuning, not regime noise. Fixing this benefits ML, the heuristic shadow, the LLM brief, and the dashboard simultaneously.
   - **Calibration check** — reliability diagrams against the persisted `mlTotal` vs `qualityAtPoint`. Add Platt scaling if miscalibration shows up.
   - **Weekly retrain cadence** — currently manual; automate once HTF investigation settles.
3. **L2 — active next.** Build once HTF and calibration are addressed (so we're not embedding a known-broken sub-score as a feature).
4. **L3 — gated on data volume.** Audit `DimensionSnapshot` history and prototype the synthetic-label backfill before considering L3 directly.
5. **L4 — only after L3 has been in production long enough to have a clear ceiling.**
