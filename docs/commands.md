# Commands Reference

All commands run from the repo root unless noted. The package manager is `pnpm`; the build orchestrator is `turbo`.

## Setup

```bash
pnpm bootstrap        # Install pnpm deps + create Python venv + install Python ML deps
pnpm install          # pnpm deps only
pnpm db:generate      # Regenerate Prisma client after schema changes
pnpm db:migrate       # Apply pending Prisma migrations to the database
```

## Type checking & build

```bash
turbo typecheck       # Type-check all packages (run this after any TypeScript change)
turbo build           # Build all packages
turbo lint            # Lint all packages
turbo lint:fix        # Auto-fix lint errors
```

## Dev servers

```bash
pnpm dev:api          # API server (Hono, port 3001)
pnpm dev:web          # Web dashboard (React Router dev server with HMR)
```

## Pipeline execution

```bash
pnpm brief            # Run all dimensions + synthesis → saves Brief to DB
pnpm notify           # brief + Telegram delivery
pnpm derivatives      # Derivatives structure analysis only
pnpm etfs             # ETF flows analysis only
pnpm htf              # High-timeframe technical analysis only
pnpm sentiment        # Sentiment analysis only
```

## Debugging (pipeline package)

Run these via `pnpm --filter @market-intel/pipeline <script>` or from `packages/pipeline/`.

```bash
pnpm debug:brief           # Re-run brief synthesis from the last saved Brief row
pnpm debug:confluence      # Print per-dim confluence scores for the latest Brief
pnpm debug:delta           # Show regime deltas between the two most recent Briefs
pnpm debug:etf             # Debug ETF flows context
pnpm debug:exchange-flows  # Debug exchange flows context
pnpm debug:funding         # Debug funding pressure signals
pnpm debug:htf             # Debug HTF context and bias
pnpm debug:htf-divergence  # Debug HTF CVD divergence signals
pnpm debug:list-briefs     # List recent Brief rows with timestamps
pnpm debug:outcomes        # Show outcome distribution for resolved trade ideas
pnpm debug:quality         # Debug quality-at-point scoring
pnpm debug:sentiment       # Debug sentiment context
pnpm debug:synthesizer     # Step through the trade-idea synthesizer interactively
pnpm debug:twitter         # Debug Twitter/X synthesis output
pnpm debug:volatility      # Debug ATR and volatility signals
```

## Snapshots

```bash
pnpm backfill:snapshots    # Backfill missing DimensionSnapshot rows
pnpm verify:snapshots      # Verify snapshot integrity
```

## ML — data and training

```bash
pnpm ml:audit              # Report per-asset usable row count, class balance, date range
pnpm ml:backfill-features  # Patch rawFeatures into TradeIdea rows missing it
pnpm ml:backfill-features --dry-run   # Preview what would be patched, no writes
pnpm ml:smoke              # Smoke-test the L1 ML aggregator with synthetic inputs
pnpm ml:compare            # Compare ML-driven vs heuristic decisions on historical rows
```

### Training (from `packages/pipeline/training/`)

```bash
# L2a per-dim sub-models (run for all 8 combinations)
.venv/bin/python train_dim.py --dim HTF --asset BTC --verify
.venv/bin/python train_dim.py --dim HTF --asset ETH --verify
.venv/bin/python train_dim.py --dim DERIVATIVES --asset BTC --verify
.venv/bin/python train_dim.py --dim DERIVATIVES --asset ETH --verify
.venv/bin/python train_dim.py --dim ETFS --asset BTC --verify
.venv/bin/python train_dim.py --dim ETFS --asset ETH --verify
.venv/bin/python train_dim.py --dim EXCHANGE_FLOWS --asset BTC --verify
.venv/bin/python train_dim.py --dim EXCHANGE_FLOWS --asset ETH --verify

# L1 cross-dim aggregator
.venv/bin/python train.py --asset BTC --verify
.venv/bin/python train.py --asset ETH --verify
```

`--verify` re-runs inference through `onnxruntime` after export and confirms parity. Always use it.

### ML model versioning

```bash
# Use a non-default version (old version stays on disk for rollback)
INTRADIM_ML_VERSION=v2 pnpm brief          # L2a models
ML_AGGREGATOR_VERSION=v2 pnpm brief        # L1 model
```

## Targeting a single package

```bash
pnpm --filter @market-intel/pipeline <script>
pnpm --filter @market-intel/api <script>
pnpm --filter @market-intel/web <script>
```
