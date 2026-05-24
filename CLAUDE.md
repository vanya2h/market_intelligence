# CLAUDE.md

Market Intelligence Engine for crypto (BTC/ETH). Collects data from external APIs, runs deterministic regime analysis, uses Claude LLM agents per dimension, produces trade ideas and briefs delivered via Telegram, Twitter, and a dashboard.

## Core constraints

- **TypeScript strict mode. No `any` types.** Find the correct type — do not cast away the problem.
- **ESM throughout.** Every package uses `"type": "module"`. Pipeline scripts run via `tsx` with no compile step.
- **No test suite.** Verify correctness by running the actual pipeline commands and checking typecheck.
- **Always run `turbo typecheck` after any TypeScript change** before considering work done.

## Reference documents

Before working on any area below, read the corresponding document first. After making changes, update the document to reflect what changed.

| Area | Document | When to read it |
|---|---|---|
| Architecture, package layout, DB schema, orchestrator files, API, web stack | [`docs/architecture.md`](docs/architecture.md) | Adding a package, changing how dimensions connect, modifying Prisma schema, cross-package concerns |
| Commands, scripts, dev workflow, ML training invocations | [`docs/commands.md`](docs/commands.md) | Before running any pipeline command, debugging, or training a model |
| ML scoring, confluence, feature encoding, intradim/L1 models, `feature_schema.json`, `extract-features.ts`, `intradim-ml.ts`, `ml-aggregator.ts`, `confluence.ts`, `TradeIdea.confluence` persistence | [`docs/ml_inference.md`](docs/ml_inference.md) | Any change to how per-dim or cross-dim scores are produced, how features are encoded, how models are loaded or versioned |
| ML roadmap, training scripts, `train.py`, `train_dim.py`, label semantics | [`docs/ml_roadmap.md`](docs/ml_roadmap.md) | Structural changes to the training approach or when a new ML level ships |
