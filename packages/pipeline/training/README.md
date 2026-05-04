# L1 Confluence Aggregator — Training

Logistic regression on the four per-dim confluence scores (`derivatives`, `etfs`, `htf`, `exchangeFlows`). Replaces the IC-weighted heuristic in [`confluence.ts`](../src/orchestrator/trade-idea/confluence.ts) with a learned `P(win)`, mapped back to a `-1..+1` total via `2*p - 1` so the rest of the pipeline (sizing, bias, targets) is unchanged.

## Setup

One-time:

```bash
cd packages/pipeline/training
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`DATABASE_URL` is read from the repo-root `.env`.

## Train

Per asset:

```bash
.venv/bin/python train.py --asset BTC --verify
.venv/bin/python train.py --asset ETH --verify
```

Outputs:
- `../models/confluence_<asset>_v1.onnx` — the model
- `../models/confluence_<asset>_v1.meta.json` — features, coefficients, CV metrics, dataset stats

`--verify` re-runs inference through `onnxruntime` and confirms the exported ONNX matches the sklearn model. Recommended on every retrain.

To bump the version (keeps the old model on disk for rollback):

```bash
.venv/bin/python train.py --asset BTC --version v2
ML_AGGREGATOR_VERSION=v2 pnpm brief
```

## What gets logged during training

- **Walk-forward CV (TimeSeriesSplit, ≤5 folds)** — out-of-fold accuracy / log-loss / Brier score. This is the honest performance estimate.
- **Heuristic baseline** — the same metrics computed against the prior IC-weighted total, so the uplift is visible.
- **Final coefficients** — sign and magnitude per dimension. Negative coefficients mean the dimension was anti-predictive over the training window. This is a regime signal worth eyeballing on every retrain.
- **In-sample metrics** — for sanity. Don't read into this; CV is what counts.

## Inference (Node)

[`ml-aggregator.ts`](../src/orchestrator/trade-idea/ml-aggregator.ts) always tries to run, caches successful loads, and **silently falls back to the heuristic `total` (logging a warning)** when the `.onnx` / `.meta.json` is missing or inference fails. Failures are not cached, so a freshly-trained model is picked up on the next brief without restarting the process.

The decision score downstream is `mlTotal ?? total` — when ML produced a result, it drives sizing, bias, and target computation; otherwise the heuristic IC-weighted total is used.

Each saved trade idea records `confluence.aggregator = { source, modelVersion?, pWin? }` so historical analysis can distinguish ML-driven from heuristic-driven decisions.

## Smoke test

```bash
pnpm ml:smoke                              # default: uses confluence_<asset>_v1
ML_AGGREGATOR_VERSION=v99 pnpm ml:smoke    # missing model → null fallback + warning
```

## Data audit

Before training (or after schema changes), check viability:

```bash
pnpm ml:audit
```

Reports per-asset usable rows, class balance, and a verdict.

## When to retrain

- **Weekly** as a default cadence — crypto regimes drift fast and 37–60 days of data overfits the current regime.
- **Whenever the brief schema changes** in a way that affects the per-dim scores (e.g., new sub-feature in derivatives, threshold rebalancing). Coefficients calibrated to the old scores will be wrong.
- **After a noticeable performance drop** — if the recent IC turns negative on a dimension and stays there, retrain to absorb the regime change.

## Caveats

- **Only ~37 days of data at L1 launch.** OOF accuracy is borderline (50–60%). Treat early predictions as exploratory; track aggregator source in `TradeIdea.confluence` and analyze ML-vs-heuristic uplift over time.
- **Per-asset models, not cross-asset.** BTC and ETH have shown materially different coefficient signs in early training. Don't pool.
- **No calibration step yet.** If reliability diagrams show miscalibration, add Platt scaling on a holdout fold before final fit.
- **Heuristic fallback is the safety net.** Before deleting any code in `confluence.ts` (the IC weighting, the fire override), you want at least 2–3 months of side-by-side comparison.
