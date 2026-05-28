## ML Roadmap

How machine learning produces the trade score. The **Snapshot model is the current primary path** — a single cross-dimension Ridge regression trained directly on price returns. L2a (intradim) and L1 (aggregator) exist as a fallback chain when the snapshot model is absent.

For the live inference pipeline (data flow, encoding, persistence schema, feature list), see [`ml_inference.md`](./ml_inference.md).

---

## Current primary: Snapshot model

### What it does

Trained on every `HtfSnapshot` (not just trade ideas), predicting the 168h forward price return from the cross-dimension feature vector. Replaces the entire L1 + L2a stack when the model file is present.

| | |
|---|---|
| **Training data** | All `HtfSnapshot` rows with a recorded price, joined to latest-before snapshot from each other dimension table at the same timestamp |
| **Label** | `clip(return_pct / 3σ, -1, 1)` where `return_pct = (price_T+168h − price_T) / price_T` |
| **Features** | 54 features from DERIVATIVES + HTF dimensions only. ETFs and Exchange Flows were dropped after dimension search showed they reduce OOF IC. Full list in [`ml_inference.md`](./ml_inference.md) |
| **Model** | `Ridge(alpha=10)` — strong L2 because N/p ratio (~400/54 ≈ 7) is low |
| **Training** | `packages/pipeline/training/train_snapshot.py` via `pnpm ml:train-snapshot` |
| **Inference** | [`snapshot-ml.ts`](../packages/pipeline/src/orchestrator/trade-idea/snapshot-ml.ts) via `onnxruntime-node`, model cache per process |
| **Per-asset** | Separate BTC and ETH models |
| **Failure policy** | Returns `null` → caller falls back to L2a + L1 chain → heuristic equal-weight |
| **Artifacts** | `packages/pipeline/models/snapshot_{asset}_{version}.{onnx,meta.json}` |

### Why this is better than the old approach

The old system (L1 + L2a) had three compounding problems:

1. **Look-ahead label** — `qualityAtPoint` was the peak-quality hour across 720 hours, picked in hindsight.
2. **Selection bias** — training set was only trade ideas with conviction ≥ 200, inheriting the heuristic's blindspots.
3. **Bootstrapped target** — models were trained to predict the heuristic's output, not price.

The snapshot model fixes all three: trains on all market states, labels are fixed-horizon forward returns from actual prices, no heuristic in the loop.

### First training results (2026-05)

| Asset | OOF IC | p-value | Rows | Dims |
|-------|--------|---------|------|------|
| BTC   | +0.657 | <0.001  | ~420 | DERIVATIVES+HTF |
| ETH   | +0.716 | <0.001  | ~405 | DERIVATIVES+HTF |

ETFs and Exchange Flows were tested and found to reduce OOF IC on both assets — see `training/compare_dimensions.py`. ETF flow data (daily granularity in a 4H pipeline) adds noise; Exchange Flows is neutral when HTF is present.

OOF IC is walk-forward (TimeSeriesSplit), so it reflects genuine out-of-sample predictive power.

### Pipeline integration

```
processTradeIdea()
  → runSnapshotMl()       ← primary
  → (null) → runIntradimMl() + runMlAggregator()  ← L2a + L1 fallback
  → (null) → getConfluenceTotal()                  ← heuristic fallback
```

---

## Legacy fallback: L2a + L1

These models remain in the codebase as a fallback chain when snapshot model is absent (asset not yet trained, ONNX file missing). They are not actively retrained.

### L1 — Cross-dim aggregator

- [`ml-aggregator.ts`](../packages/pipeline/src/orchestrator/trade-idea/ml-aggregator.ts)
- Input: four per-dim heuristic scores from `confluence.ts`
- Output: `mlTotal = 2*pWin - 1` in `[-1, +1]`
- Model: `LogisticRegression(L2, class_weight='balanced')`
- Artifacts: `models/confluence_{asset}_{version}.{onnx,meta.json}`

### L2a — Per-dimension sub-models

- [`intradim-ml.ts`](../packages/pipeline/src/orchestrator/trade-idea/intradim-ml.ts)
- 8 ONNX models (4 dims × 2 assets), amplitude-encoded features
- Input: raw dimension features from `extractRawFeatures()`
- Output: per-dim score in `[-1, +1]`
- Always runs even when snapshot model is present (for display in the brief)

### Why L2a still runs

Even when the snapshot model is active, `intradimMl` scores are computed and persisted for UI display and the per-dimension breakdown in the brief. They serve as an interpretability layer, not the decision.

---

## Roadmap

### Near-term

1. **Multi-horizon ensemble** — train separate Ridge models for 24h, 48h, 72h, 168h horizons; ensemble predictions. The training CSV already contains all four horizons. First step: compare OOF IC per horizon to find the predictive sweet spot.

2. **Weekly retrain** — as more snapshots accumulate (target: 1000+ rows), retrain on a rolling window. Currently manual (`pnpm ml:gen-training-data && pnpm ml:train-snapshot`).

3. **Regime-aware retraining** — hold out the most recent 90 days as a validation set; retrain when recent-window IC drops below +0.3.

### Medium-term

4. **Trajectory features** — today every training row is point-in-time. Add rolling features: 24h slope of OI z-score, 5-day ETF sigma momentum, funding-percentile change since regime entry. Most macro alpha lives in trajectory, not static snapshots.

5. **Calibration** — Ridge outputs a regression score, mapped to `[-1, +1]` by clipping. As sizing relies on magnitude, add isotonic calibration on a validation fold to ensure the magnitude is meaningful.

### Long-term

6. **End-to-end temporal model** — 1D-CNN or small transformer over raw indicator time series. Gate on: ≥ 2000 labeled rows and stable feature schema for ≥ 6 months. Use SHAP for interpretability.

---

## Cross-cutting concerns

### Walk-forward CV

Random K-fold leaks future into past — fatal for time series. All models use `sklearn.model_selection.TimeSeriesSplit`. Train on Jan–Mar, test on Apr. Step forward.

### Regime drift

Crypto regimes shift fast. Mitigations:
- Periodic retrain (weekly/monthly target).
- Hold out most-recent 90 days as regime validation set.
- `recentIc` from [`ic-weights.ts`](../packages/pipeline/src/orchestrator/trade-idea/ic-weights.ts) surfaces per-dim drift in the Signals panel.

### Hand-crafted features as priors

The heuristic encoding in `extractRawFeatures()` encodes domain knowledge (funding decay, regime transitions) that pure data rarely recovers with limited samples. Don't replace it — it's the feature engineering layer.

### Evaluation

- **Primary:** OOF IC (Pearson/Spearman) — direction prediction.
- **Secondary:** hit rate at each horizon.
- **Tail:** worst 5% of trades vs heuristic baseline.
- **A/B:** `confluence.total` (heuristic) and `confluence.mlTotal` persisted side-by-side; backtest compares both without re-running the pipeline.

---

## Current status

| Model | Status | Notes |
|-------|--------|-------|
| Snapshot BTC v1 | ✅ Trained & deployed | OOF IC +0.630, ~500 rows |
| Snapshot ETH v1 | ✅ Trained & deployed | OOF IC +0.668, ~480 rows |
| L2a (intradim) | Legacy | Runs for display; not retrained |
| L1 (aggregator) | Legacy | Fallback when snapshot absent |
