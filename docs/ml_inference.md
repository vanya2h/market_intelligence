# ML Inference — How a Trade Decision Is Scored

This document describes the live ML scoring pipeline: what runs on every brief, how inputs are transformed, where models fit in, and what the persistence layer records. For the training workflow, see [`packages/pipeline/training/README.md`](../packages/pipeline/training/README.md). For the roadmap and future levels, see [`ml_roadmap.md`](./ml_roadmap.md).

---

## Architecture overview

The system uses two stacked ML layers:

```
Raw context (per dimension)
    │
    ▼
[extract-features.ts]   ← amplitude-encoded feature vectors
    │
    ├── [intradim-ml.ts] L2a   ← per-dim ONNX models: P(price goes up)
    │       │ fallback ↓
    │   [confluence.ts]        ← heuristic score if model missing
    │
    ▼
Effective per-dim scores [-1, +1]   (4 values)
    │
    ├── [ml-aggregator.ts] L1  ← cross-dim ONNX model: P(trade wins)
    │       │ fallback ↓
    │   equal-weight mean       ← if L1 model missing
    │
    ▼
confluenceTotal [-1, +1]
    │
    ├── direction: sign → LONG / SHORT
    └── sizing: |confluenceTotal| → position size %
```

Every layer degrades gracefully. A missing ONNX file triggers a warning and the next fallback; the brief always produces a decision.

---

## Layer 2a — Per-dimension sub-models

### What they answer

Each L2a model answers a single question: **"Given what we see in this dimension right now, what is P(price goes up)?"**

This is the market-direction label, not trade success:
- `LONG` trade + `qualityAtPoint > 0` → price went up → `label = 1`
- `LONG` trade + `qualityAtPoint < 0` → price went down → `label = 0`
- `SHORT` trade + `qualityAtPoint > 0` → price went UP (SHORT lost) → `label = 1`
- `SHORT` trade + `qualityAtPoint < 0` → price went DOWN (SHORT won) → `label = 0`

The model answers "should we buy here?" unconditionally — the pipeline separately decides whether to follow or fade the signal based on the full cross-dim picture.

### Output

```
score = 2 × pUp - 1    ∈ [-1, +1]
```

+1 = fully confident price will rise, -1 = fully confident price will fall, 0 = no signal. Same contract as the heuristic scores it replaces.

### Feature extraction ([`extract-features.ts`](../packages/pipeline/src/orchestrator/trade-idea/extract-features.ts))

Raw context objects are flattened into `Record<string, number>`. Two encoding rules apply:

**Numerics** — passed through as-is. Examples: `fundingPct1m`, `rsiH4`, `oiZScore30d`, `reserveChange7dPct`.

**Categoricals** — each Prisma enum value is mapped to a signed amplitude in `[-1, +1]` via [`feature_schema.json`](../packages/pipeline/training/feature_schema.json). Examples:

| Enum | Value | Amplitude |
|---|---|---|
| PositioningRegime | CROWDED_SHORT | +1.0 |
| PositioningRegime | CROWDED_LONG | -1.0 |
| HtfRegime | BEAR_EXTENDED | +0.8 (mean-reversion: extreme bear = buy) |
| HtfRegime | BULL_EXTENDED | -0.8 |
| ExchangeFlowsRegime | ACCUMULATION | +1.0 |
| EtfRegime | REVERSAL_TO_INFLOW | +0.6 |
| StressLevel | CAPITULATION | +1.0 |
| FundingPressureSide | LONG | -0.5 (crowded longs = bearish) |

This encoding approach — scalars on `[-1, +1]` rather than one-hot — lets the model learn magnitude and direction of each regime state directly. One-hot would require 2–6 coefficients per enum where one scalar suffices.

**Previous-regime fields** are encoded at 50% decay (`decay = 0.5`): `previousPositioning`, `previousRegime`, etc. This tells the model how recently the regime changed without adding a separate recency feature.

**Booleans** are signed: `isAt30dLow → 1.0`, `isAt30dHigh → -1.0`. These are independent signals so two separate features are more informative than one.

**Staleness** (HTF only): `null → -1` (signal absent), `0 → 0` (fresh), `20+ candles → 1` (stale). Lets the model discount faded signals automatically.

`feature_schema.json` is the single source of truth for encoding maps. Both the Python training script and the TypeScript inference module read it — there is no drift possible between training-time and inference-time encoding.

### Feature counts

| Dimension | Numeric | Categorical | Boolean | Total |
|---|---|---|---|---|
| DERIVATIVES | 9 | 6 | 0 | **15** |
| ETFS | 8 | 2 | 0 | **10** |
| HTF | 22 | 17 | 0 | **39** |
| EXCHANGE_FLOWS | 8 | 3 | 2 | **13** |

`durationHours` is present in all four dimensions. It encodes how long the current regime has been active, normalized to [0, 1] over a 30-day cap (720h). Value 0 = regime just started or `since` unavailable; value 1 = regime active 30+ days. This gives the model the "where are we in the regime lifecycle" signal that the previous-regime-with-decay feature cannot fully capture.

### Model

Logistic regression with L1 regularization (sparse feature selection), `liblinear` solver, `class_weight='balanced'` (handles the ~65/35 up/down imbalance), `C=1.0`. One model per dimension per asset = 8 total.

L1 penalty sparsifies coefficients — features with no predictive signal are zeroed out. This is intentional: a 38-feature HTF model on 300 rows cannot afford dense weights.

### Training results (first run, ~60 days of data, ~280–302 rows per dim/asset)

| Dim | Asset | OOF Acc | Heuristic Acc | Non-zero / Total |
|---|---|---|---|---|
| HTF | BTC | 0.440 | 0.550 | 27/38 |
| HTF | ETH | **0.580** | 0.534 | 21/38 |
| DERIVATIVES | BTC | 0.436 | 0.497 | 10/14 |
| DERIVATIVES | ETH | 0.539 | n/a | 11/14 |
| EXCHANGE_FLOWS | BTC | 0.498 | 0.545 | 10/12 |
| EXCHANGE_FLOWS | ETH | 0.500 | 0.621 | 8/12 |
| ETFS | BTC | 0.480 | 0.505 | 9/9 |
| ETFS | ETH | **0.564** | 0.487 | 5/9 |

OOF accuracy is the honest estimate (walk-forward CV, TimeSeriesSplit). With 60 days of data it is expected to be borderline (50–60%). The heuristic numbers are also borderline, confirming neither method has a clear edge yet — but the ML models will improve as data accumulates and will absorb regime changes on retrain; the heuristic cannot.

Notable per-dim findings:
- **HTF/BTC**: heuristic beats ML out-of-fold (0.55 vs 0.44). The HTF heuristic uses a pre-computed `bias.composite` that already aggregates many sub-signals — ML may not add much beyond that composite on limited data.
- **HTF/ETH and ETFS/ETH**: ML beats heuristic — suggesting the heuristic thresholds are miscalibrated for ETH's different volatility regime.
- **Non-zero coefficients**: L1 is aggressively sparse. ETFS/ETH zeroed 4/9 features; EXCHANGE_FLOWS/ETH zeroed 4/12. Surviving features have real signal on this dataset.

### Strongest per-feature signals (Pearson IC vs market direction)

**HTF/ETH** (most predictive dim overall):

| Feature | IC |
|---|---|
| rsiH4 | -0.322 (overbought H4 RSI = bearish) |
| rsiDaily | -0.263 |
| stalenessMfiExtreme | +0.240 (stale extremes = reversal fading) |
| biasMomentum | +0.225 |
| cvdFuturesLongRegime | -0.221 |

**ETFS/ETH**: `priorStreakSigmas` IC = +0.339 — cumulative prior streak magnitude (in σ units) is the strongest ETF signal for ETH.

**EXCHANGE_FLOWS/ETH**: `previousRegime` IC = -0.283 — the *prior* exchange flows regime is more predictive than the current one, suggesting mean-reversion after regime transitions.

### Inference ([`intradim-ml.ts`](../packages/pipeline/src/orchestrator/trade-idea/intradim-ml.ts))

```typescript
const intradimMl = await runIntradimMl(asset, rawFeatures);
// { DERIVATIVES: { score: 0.2, pUp: 0.6, modelVersion: "v1" }, HTF: { ... }, ... }
```

All 4 models run in parallel (`Promise.all`). Each model:
1. Looks up the ONNX session from a success-only cache (Map keyed by `${dim}_${asset}`)
2. Reads `feature_order` from the `.meta.json` to build the float array in canonical order
3. Runs inference, reads the probability output at index `onnx_output_index_for_win`
4. Returns `{ score: 2*pUp - 1, pUp, modelVersion }` or `null` on any failure

Missing model files produce a one-time warning and `null`. The cache never stores failures — a freshly-trained model is picked up on the next brief without restarting the process.

---

## Merging L2a into effective confluence

After L2a inference, per-dim scores are merged:

```typescript
const confluence: Confluence = {
  DERIVATIVES: intradimMl.DERIVATIVES?.score ?? heuristicConfluence.DERIVATIVES,
  ETFS:        intradimMl.ETFS?.score        ?? heuristicConfluence.ETFS,
  HTF:         intradimMl.HTF?.score         ?? heuristicConfluence.HTF,
  EXCHANGE_FLOWS: intradimMl.EXCHANGE_FLOWS?.score ?? heuristicConfluence.EXCHANGE_FLOWS,
};
```

The heuristic score is still computed for every dim on every brief — it is never skipped. It is the fallback and the audit comparator. In the console output, ML-driven dims are marked with `*`: `HTF:+0.24*  DERIVATIVES:-0.05  ETFS:+0.36*  EXCHANGE_FLOWS:+0.18*  (* = L2a ML, 3/4 dims)`.

---

## Layer 1 — Cross-dimension aggregator

### What it answers

Given the four per-dim scores (now ML-corrected where possible), **"P(this trade wins given the full cross-dim picture)?"**

Trade-success label: `qualityAtPoint > 0` = win, regardless of direction.

### Output

```
mlTotal = 2 × pWin - 1    ∈ [-1, +1]
```

### Model

Logistic regression (L2 regularization, default sklearn), `class_weight='balanced'`. 4 features = 4 per-dim confluence scores. Per-asset.

### Inference ([`ml-aggregator.ts`](../packages/pipeline/src/orchestrator/trade-idea/ml-aggregator.ts))

Takes the 4 effective per-dim scores (post-L2a merge) as input. Returns `{ mlTotal, pWin, modelVersion }` or `null`.

The critical coupling: **the per-dim scores fed to L1 are whatever the effective confluence is — ML-corrected or heuristic**. This means when L2a models improve the per-dim scores, L1 gets better inputs automatically without retraining. However, when L1 was originally trained, it used heuristic scores as inputs. Once L2a is stable, retrain L1 on rows where per-dim scores came from L2a models.

### Fallback chain

| Condition | `confluenceTotal` |
|---|---|
| L1 ML runs | `ml.mlTotal` |
| L1 missing / error | `mean(confluence[DERIVATIVES, ETFS, HTF, EXCHANGE_FLOWS])` |

---

## Direction and sizing

```
direction        = confluenceTotal >= 0 ? "LONG" : "SHORT"
conviction       = |confluenceTotal|    ∈ [0, 1]
multiplier       = 2.0 × conviction^1.5
positionSizePct  = clamp(base × multiplier, 0, 150%)
```

Where `base = DAILY_VOL_TARGET / (ATR_4h / price)`. Position size naturally goes to zero as conviction approaches zero — there is no hard "skip" threshold; the model determines whether to take a position by the magnitude of its total output.

---

## Persistence schema

Every trade idea stores the full audit trail in `TradeIdea.confluence` (JSONB):

```json
{
  "DERIVATIVES": -0.05,
  "ETFS": 0.36,
  "HTF": 0.24,
  "EXCHANGE_FLOWS": 0.18,
  "total": 0.183,
  "sizing": { "positionSizePct": 42, "convictionMultiplier": 0.71, "dailyVolPct": 1.8 },
  "aggregator": { "source": "ml", "modelVersion": "v1", "pWin": 0.591 },
  "intradim": {
    "DERIVATIVES": { "score": -0.05, "pUp": 0.475, "modelVersion": "v1" },
    "ETFS":        { "score": 0.36,  "pUp": 0.68,  "modelVersion": "v1" },
    "HTF":         { "source": "heuristic" },
    "EXCHANGE_FLOWS": { "score": 0.18, "pUp": 0.59, "modelVersion": "v1" }
  },
  "rawFeatures": {
    "DERIVATIVES": { "fundingPct1m": 62, "oiZScore30d": 0.4, "stressState": 0.0, ... },
    "ETFS": { "todaySigma": 1.8, "regime": 1.0, ... },
    "HTF": { "biasComposite": 0.28, "rsiH4": 54, ... },
    "EXCHANGE_FLOWS": { "reserveChange7dPct": -1.2, "isAt30dLow": 1.0, ... }
  }
}
```

- Per-dim scores (top-level) are the **effective** scores (ML or heuristic) — what actually drove the decision.
- `aggregator` records which L1 source ran (ml or fallback) and its `pWin`.
- `intradim` records per-dim L2a results. A missing key means heuristic was used for that dim.
- `rawFeatures` is the training source for future retraining — these are the amplitude-encoded inputs, not the raw analyzer outputs.

This layout allows per-row auditing: for any historical trade idea, you can reconstruct which dims used ML, what pUp each model produced, what the heuristic would have said (compare effective score to heuristic), and re-run the full L1 aggregator with different model weights.

---

## Model artifacts

```
packages/pipeline/models/
  confluence_btc_v1.{onnx,meta.json}    ← L1 BTC
  confluence_eth_v1.{onnx,meta.json}    ← L1 ETH
  dim_derivatives_btc_v1.{onnx,meta.json}   ← L2a
  dim_derivatives_eth_v1.{onnx,meta.json}
  dim_etfs_btc_v1.{onnx,meta.json}
  dim_etfs_eth_v1.{onnx,meta.json}
  dim_htf_btc_v1.{onnx,meta.json}
  dim_htf_eth_v1.{onnx,meta.json}
  dim_exchange_flows_btc_v1.{onnx,meta.json}
  dim_exchange_flows_eth_v1.{onnx,meta.json}
```

Each `.meta.json` records: feature order, trained-at timestamp, n_samples, date range, CV metrics, per-feature Pearson IC, non-zero coefficients, heuristic baseline comparison.

### Versioning

```bash
# Use a specific L2a version for one asset
INTRADIM_ML_VERSION=v2 pnpm brief

# Use a specific L1 version
ML_AGGREGATOR_VERSION=v2 pnpm brief
```

Old artifacts are not deleted on retrain — the old `.onnx` stays on disk as a rollback target. The pipeline picks up new models on the next brief without restart (failures are never cached; successful loads are).

---

## Operational: retraining

### When to retrain

- **Weekly** — crypto regimes drift; models trained on 60 days of data have a short shelf life.
- **After schema changes** — any new feature in `extract-features.ts` or `feature_schema.json` invalidates existing models (trained on old feature vectors).
- **After performance drop** — if recent OOF accuracy on fresh data drops below the heuristic baseline, retrain to absorb the regime.

### Retrain L2a (per-dim sub-models)

```bash
cd packages/pipeline/training
.venv/bin/python train_dim.py --dim HTF --asset BTC --verify
.venv/bin/python train_dim.py --dim HTF --asset ETH --verify
# repeat for DERIVATIVES, ETFS, EXCHANGE_FLOWS
```

Or all 8 at once:

```bash
for DIM in HTF DERIVATIVES EXCHANGE_FLOWS ETFS; do
  for ASSET in BTC ETH; do
    .venv/bin/python train_dim.py --dim $DIM --asset $ASSET --verify
  done
done
```

### Retrain L1 (cross-dim aggregator)

After L2a is stable (or when per-dim data drift is detected):

```bash
.venv/bin/python train.py --asset BTC --verify
.venv/bin/python train.py --asset ETH --verify
```

Note: the current L1 was trained on heuristic per-dim scores as inputs. Once L2a is the dominant input source, retrain L1 on rows where `confluence.intradim` was set — it will learn to aggregate ML scores rather than heuristic scores.

### Data prerequisites

Before any retrain, verify coverage:

```bash
pnpm ml:audit              # row count, class balance, date range per asset
pnpm ml:backfill-features  # patch rawFeatures into any rows missing it
```

---

## Adding a new dimension

1. Add the dimension to `DimensionEnum` and `CONFLUENCE_DIMENSIONS` in `dimensions.ts`.
2. Write an extractor function in `extract-features.ts` and add it to `extractRawFeatures`.
3. Add the dimension's `feature_sets` entry to `feature_schema.json` (must stay in lockstep with the extractor).
4. Run `pnpm ml:backfill-features` to patch `rawFeatures` on historical trade ideas.
5. Train the new dim's L2a model: `train_dim.py --dim NEW_DIM --asset BTC`.
6. Add the new dim to `runIntradimMl` in `intradim-ml.ts`.
7. Add the merge line in `index.ts`.
8. Retrain L1 (`train.py`) once enough data exists with the new dim in play.
