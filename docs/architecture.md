# Architecture Reference

For the high-level stack table and pipeline flow diagram, see [`technical_spec.md`](./technical_spec.md).

## Monorepo layout

pnpm workspaces + Turborepo. Three packages under `packages/`:

| Package | Path | Role |
|---|---|---|
| `@market-intel/pipeline` | `packages/pipeline/` | Data collection, analysis, LLM agents, ML scoring, orchestration, persistence |
| `@market-intel/api` | `packages/api/` | REST API (Hono + Zod) serving briefs, dimensions, prices, trade ideas |
| `@market-intel/web` | `packages/web/` | React 19 dashboard (React Router v7, SSR, Tailwind v4, Recharts) |

## Pipeline package

### Dimension pattern

Every dimension in `packages/pipeline/src/` follows the same three-step structure:

1. **Collector** — fetches raw data from an external API (Coinglass, Unbias, Binance)
2. **Analyzer** — deterministic classification into regime states using thresholds/percentiles
3. **Agent** — LLM call (Claude) that interprets the analysis into natural language with context

Current dimensions: `derivatives_structure/`, `etfs/`, `htf/`, `sentiment/`, `exchange_flows/`

### Orchestrator (`packages/pipeline/src/orchestrator/`)

| File | Role |
|---|---|
| `pipeline.ts` | Runs all dimensions in parallel (collect → analyze → agent), returns outputs |
| `synthesizer.ts` | LLM text brief from dimension outputs |
| `rich-synthesizer.ts` | Structured block format for the visual dashboard |
| `delta.ts` | Regime-change diff between two consecutive runs |
| `trade-idea/` | Confluence scoring, ML inference, sizing, target computation, persistence |
| `notify.ts` / `notify-run.ts` | Telegram delivery with resumable pipeline state |
| `scheduler.ts` | Cron-based scheduling (hourly + 3x/day) |
| `dimensions.ts` | `DimensionEnum` and `CONFLUENCE_DIMENSIONS` — canonical ordering |

### Trade-idea sub-directory (`packages/pipeline/src/orchestrator/trade-idea/`)

| File | Role |
|---|---|
| `index.ts` | Entry point — wires heuristic → L2a → L1 → direction → sizing → persist |
| `confluence.ts` | Heuristic per-dim scoring functions (fallback layer) |
| `extract-features.ts` | Amplitude-encodes dimension contexts into flat feature vectors |
| `intradim-ml.ts` | L2a ONNX inference — per-dim sub-models |
| `ml-aggregator.ts` | L1 ONNX inference — cross-dim aggregator |
| `sizing.ts` | Volatility-targeted, conviction-scaled position sizing |
| `composite-target.ts` | HTF-anchored entry, target, and invalidation levels |
| `persist.ts` | Writes TradeIdea + levels to DB |

For the ML scoring flow specifically, see [`ml_inference.md`](./ml_inference.md).

## Database (Prisma)

Schema: `packages/pipeline/prisma/schema.prisma`. Generated client is shared between pipeline and API.

The API package references the pipeline schema: `prisma generate --schema=../pipeline/prisma/schema.prisma`.

### Key models

| Model | Purpose |
|---|---|
| `Brief` | One per pipeline run — parent of all dimension rows |
| `DerivativesDimension`, `EtfsDimension`, `HtfDimension`, `ExchangeFlowsDimension` | Dimension-level output per Brief |
| `DimensionState` | Mutable current-regime tracker (one row per dim/asset, updated in place) |
| `DimensionSnapshot` | Time-series of regime state — source for charts and future ML feature engineering |
| `TradeIdea` | Mechanical trade decision with confluence JSON, levels, sizing, ML audit trail |
| `TradeIdeaReturn` | Outcome rows written as price milestones are hit post-trade |
| `NotifyRun` | Resumable pipeline state for Telegram delivery |

## API package

Hono framework with type-safe RPC. Routes in `packages/api/src/routes/`.

The web package calls the API via `hono/client` for end-to-end type safety (`packages/web/app/lib/api.client.ts`).

## Web package

React Router v7 in framework mode (SSR enabled). Routes declared in `packages/web/app/routes.ts`. Data loading via React Router loaders that call the API server-side.

## Runtime constraints

- **Node.js 22+**, ESM throughout (`"type": "module"` in every package)
- **TypeScript strict mode**; pipeline scripts run directly via `tsx` (no compile step)
- **LLM:** Claude Sonnet via `@anthropic-ai/sdk`; shared client in `packages/pipeline/src/llm.ts` with retry on HTTP 529 (overloaded)
- **Database:** PostgreSQL via `@prisma/adapter-pg`; PGlite fallback for local dev
- **Cache:** Upstash Redis (REST API) with JSON file fallback
- **Regime types** are Prisma enums (`PositioningRegime`, `EtfRegime`, `HtfRegime`, `SentimentRegime`, `ExchangeFlowsRegime`)
- **No test suite** — verify by running pipeline commands and checking typecheck
