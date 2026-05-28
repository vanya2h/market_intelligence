# ML Inference — How a Trade Decision Is Scored

This document describes the live ML scoring pipeline: what runs on every brief, how inputs are transformed, where models fit in, and what the persistence layer records. For the training workflow, see [`packages/pipeline/training/README.md`](../packages/pipeline/training/README.md). For the roadmap and future levels, see [`ml_roadmap.md`](./ml_roadmap.md).

---

## Strategy: momentum, not mean-reversion

The system is built on a momentum thesis: **if a trend is active, ride it**. This shapes every layer:

- Feature encodings are momentum-biased (`BULL_EXTENDED` = bullish, not "fade the extension").
- The model target is `qualityAtPoint` (signed, time-decayed return) — not a win/loss binary.
- Model output is **trend strength** ∈ [-1, +1]: positive = bullish momentum, negative = bearish, near-zero = no trend.

---

## Architecture overview

The system uses two stacked ML layers:

```
Raw context (per dimension)
    │
    ▼
[extract-features.ts]   ← amplitude-encoded feature vectors
    │
    ├── [intradim-ml.ts] L2a   ← per-dim ONNX models: trend strength ∈ [-1, +1]
    │       │ fallback ↓
    │   [confluence.ts]        ← heuristic score if model missing
    │
    ▼
Effective per-dim scores [-1, +1]   (4 values)
    │
    ├── [ml-aggregator.ts] L1  ← cross-dim ONNX model: trend strength ∈ [-1, +1]
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

Each L2a model answers: **"What is the trend strength in this dimension right now?"**

This is a regression on `qualityAtPoint` (the time-decayed, direction-signed return):

- Large positive `qualityAtPoint` → strong upward momentum → target near `+1`
- Large negative `qualityAtPoint` → strong downward momentum → target near `-1`
- Near-zero `qualityAtPoint` → choppy / no trend → target near `0`

The label is normalized: `clip(qualityAtPoint / (3 × std), -1, 1)`. This maps 3-sigma returns to ±1.

### Output

```
score = clamp(regression_output, -1, +1)  ∈ [-1, +1]
```

+1 = strong bullish trend, -1 = strong bearish trend, 0 = no trend / ranging.

### Feature extraction ([`extract-features.ts`](../packages/pipeline/src/orchestrator/trade-idea/extract-features.ts))

Raw context objects are flattened into `Record<string, number>`. Two encoding rules apply:

**Numerics** — passed through as-is. Examples: `fundingPct1m`, `rsiH4`, `oiZScore30d`, `reserveChange7dPct`.

**Categoricals** — each Prisma enum value is mapped to a signed amplitude in `[-1, +1]` via [`feature_schema.json`](../packages/pipeline/training/feature_schema.json). Encodings are **momentum-biased** — extended trends score in the direction of the trend:

| Enum | Value | Amplitude |
|---|---|---|
| PositioningRegime | CROWDED_SHORT | +1.0 |
| PositioningRegime | CROWDED_LONG | -1.0 |
| HtfRegime | BULL_EXTENDED | +0.8 (momentum: strong bull = ride it) |
| HtfRegime | BEAR_EXTENDED | -0.8 (momentum: strong bear = keep shorting) |
| OiSignal | EXTREME | +0.6 (high OI = strong trend participation) |
| OiSignal | ELEVATED | +0.3 |
| ExchangeFlowsRegime | ACCUMULATION | +1.0 |
| EtfRegime | STRONG_INFLOW | +1.0 |

**Previous-regime fields** are encoded at 50% decay (`decay = 0.5`): `previousPositioning`, `previousRegime`, etc.

**Booleans** are signed: `isAt30dLow → 1.0`, `isAt30dHigh → -1.0`.

**Staleness** (HTF only): `null → -1` (signal absent), `0 → 0` (fresh), `20+ candles → 1` (stale).

`feature_schema.json` is the single source of truth for encoding maps. Both the Python training script and the TypeScript inference module read it — there is no drift possible between training-time and inference-time encoding.

### Feature counts

| Dimension | Numeric | Categorical | Boolean | Total |
|---|---|---|---|---|
| DERIVATIVES | 9 | 6 | 0 | **15** |
| ETFS | 8 | 2 | 0 | **10** |
| HTF | 22 | 17 | 0 | **39** |
| EXCHANGE_FLOWS | 8 | 3 | 2 | **13** |

`durationHours` is present in all four dimensions, encoding how long the current regime has been active (normalized to [0, 1] over a 30-day cap).

### Model

Lasso regression (L1 regularization, `alpha=0.05`, `max_iter=10000`). One model per dimension per asset = 8 total.

L1 penalty sparsifies coefficients — features with no predictive signal are zeroed out. Key evaluation metric: Pearson IC of predicted trend strength vs actual normalized `qualityAtPoint`.

### Inference ([`intradim-ml.ts`](../packages/pipeline/src/orchestrator/trade-idea/intradim-ml.ts))

```typescript
const intradimMl = await runIntradimMl(asset, rawFeatures);
// { DERIVATIVES: { score: 0.2, modelVersion: "v1" }, HTF: { ... }, ... }
```

All 4 models run in parallel (`Promise.all`). Each model:
1. Looks up the ONNX session from a success-only cache (Map keyed by `${dim}_${asset}`)
2. Reads `feature_order` from the `.meta.json` to build the float array in canonical order
3. Runs inference, reads the scalar regression output
4. Clamps to [-1, +1] and returns `{ score, modelVersion }` or throws on any failure

Missing model files produce a one-time error and throw. The cache never stores failures — a freshly-trained model is picked up on the next brief without restarting the process.

---

## Merging L2a into effective confluence

After L2a inference, per-dim scores are merged:

```typescript
const confluence: Confluence = {
  DERIVATIVES: intradimMl.DERIVATIVES.score,
  ETFS:        intradimMl.ETFS.score,
  HTF:         intradimMl.HTF.score,
  EXCHANGE_FLOWS: intradimMl.EXCHANGE_FLOWS.score,
};
```

The heuristic score from `confluence.ts` is still computed on every brief as a fallback — it is never skipped. If L2a throws for any dimension, the pipeline falls back to the heuristic score for that dim.

---

## Layer 1 — Cross-dimension aggregator

### What it answers

Given the four per-dim trend strength scores, **"What is the overall trend strength?"**

### Output

```
mlTotal = clamp(regression_output, -1, +1)  ∈ [-1, +1]
```

### Model

Ridge regression (L2 regularization, `alpha=1.0`). 4 features = 4 per-dim trend strength scores. Per-asset.

Same label: normalized `qualityAtPoint`. Ridge is stable with only 4 inputs and ~300 rows.

### Inference ([`ml-aggregator.ts`](../packages/pipeline/src/orchestrator/trade-idea/ml-aggregator.ts))

Takes the 4 effective per-dim scores as input. Returns `{ mlTotal, modelVersion }` or `null`.

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

Where `base = DAILY_VOL_TARGET / (ATR_4h / price)`. Position size naturally goes to zero as trend strength approaches zero — the model determines whether to take a position by the magnitude of its total output.

---

## Persistence schema

Every trade idea stores the full audit trail in `TradeIdea.confluence` (JSONB):

```json
{
  "DERIVATIVES": 0.18,
  "ETFS": 0.36,
  "HTF": 0.24,
  "EXCHANGE_FLOWS": 0.42,
  "total": 0.30,
  "sizing": { "positionSizePct": 42, "convictionMultiplier": 0.71, "dailyVolPct": 1.8 },
  "aggregator": { "source": "ml", "modelVersion": "v1" },
  "intradim": {
    "DERIVATIVES": { "score": 0.18, "modelVersion": "v1" },
    "ETFS":        { "score": 0.36, "modelVersion": "v1" },
    "HTF":         { "score": 0.24, "modelVersion": "v1" },
    "EXCHANGE_FLOWS": { "score": 0.42, "modelVersion": "v1" }
  },
  "rawFeatures": {
    "DERIVATIVES": { "fundingPct1m": 62, "oiZScore30d": 0.4, ... },
    "ETFS": { "todaySigma": 1.8, "regime": 1.0, ... },
    "HTF": { "biasComposite": 0.28, "rsiH4": 54, ... },
    "EXCHANGE_FLOWS": { "reserveChange7dPct": -1.2, "isAt30dLow": 1.0, ... }
  }
}
```

- Per-dim scores (top-level) are the **effective** scores — what actually drove the decision.
- `aggregator` records which L1 source ran (ml or fallback).
- `intradim` records per-dim L2a results.
- `rawFeatures` is the training source for future retraining.

---

## Model artifacts

```
packages/pipeline/models/
  confluence_btc_v1.{onnx,meta.json}    ← L1 BTC (Ridge regression)
  confluence_eth_v1.{onnx,meta.json}    ← L1 ETH
  dim_derivatives_btc_v1.{onnx,meta.json}   ← L2a (Lasso regression)
  dim_derivatives_eth_v1.{onnx,meta.json}
  dim_etfs_btc_v1.{onnx,meta.json}
  dim_etfs_eth_v1.{onnx,meta.json}
  dim_htf_btc_v1.{onnx,meta.json}
  dim_htf_eth_v1.{onnx,meta.json}
  dim_exchange_flows_btc_v1.{onnx,meta.json}
  dim_exchange_flows_eth_v1.{onnx,meta.json}
```

Each `.meta.json` records: `model_type`, `quality_scale` (normalization factor), `feature_order`, trained-at timestamp, n_samples, date range, CV metrics (R², MAE, Pearson IC), per-feature IC, non-zero coefficients, and ONNX output name.

### Versioning

```bash
# Use a specific L2a version for one asset
INTRADIM_ML_VERSION=v2 pnpm brief

# Use a specific L1 version
ML_AGGREGATOR_VERSION=v2 pnpm brief
```

Old artifacts are not deleted on retrain — the old `.onnx` stays on disk as a rollback target.

---

## Operational: retraining

### When to retrain

- **After this strategy change** — existing v1 ONNX models were trained with classification labels and mean-reversion feature encodings. They must be retrained immediately.
- **Weekly** — crypto regimes drift; models trained on limited data have a short shelf life.
- **After feature schema changes** — any change to `feature_schema.json` or `extract-features.ts` invalidates existing models.

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

Key flag: `--alpha` controls Lasso regularization (default `0.05`). Increase for smaller datasets.

### Retrain L1 (cross-dim aggregator)

```bash
.venv/bin/python train.py --asset BTC --verify
.venv/bin/python train.py --asset ETH --verify
```

Note: retrain L1 after L2a is stable so it aggregates ML-sourced per-dim scores rather than heuristic ones.

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
3. Add the dimension's `feature_sets` entry to `feature_schema.json` (momentum-biased encodings).
4. Run `pnpm ml:backfill-features` to patch `rawFeatures` on historical trade ideas.
5. Train the new dim's L2a model: `train_dim.py --dim NEW_DIM --asset BTC`.
6. Add the new dim to `runIntradimMl` in `intradim-ml.ts`.
7. Add the merge line in `index.ts`.
8. Retrain L1 (`train.py`) once enough data exists with the new dim in play.
