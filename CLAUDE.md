# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Market Intelligence Engine for crypto (BTC/ETH). Collects market data from multiple APIs, runs deterministic analysis (threshold-based regime classification), then uses Claude LLM agents (one per dimension per asset) to produce synthesized market briefs delivered via Telegram, Twitter, and a live dashboard.

## Monorepo Structure

pnpm workspaces + Turborepo. Three packages:

- **packages/pipeline** — Data collection, analysis, LLM agents, orchestration, persistence. Each dimension follows `collector → analyzer → agent` pattern.
- **packages/api** — REST API (Hono + Zod + Prisma) serving briefs, dimensions, prices, trade ideas.
- **packages/web** — React 19 dashboard with React Router v7 (framework mode, SSR), Tailwind CSS v4, Recharts.

## Commands

```bash
# Install
pnpm install

# Type checking (all packages)
turbo typecheck

# Build all packages
turbo build

# Database
pnpm db:generate          # Generate Prisma client
pnpm db:migrate           # Run migrations

# Dev servers
pnpm dev:api              # API server (Hono, port 3001)
pnpm dev:web              # Web dashboard (React Router dev)

# Run individual dimensions
pnpm derivatives          # Derivatives structure analysis
pnpm etfs                 # ETF flows analysis
pnpm htf                  # High-timeframe technical analysis
pnpm sentiment            # Sentiment analysis

# Full pipeline
pnpm brief                # All dimensions + synthesis
pnpm notify               # All dimensions + synthesis + Telegram delivery

# Filter to a specific package
pnpm --filter @market-intel/pipeline <script>
pnpm --filter @market-intel/api <script>
pnpm --filter @market-intel/web <script>
```

## Architecture

### Pipeline Dimension Pattern

Each dimension module in `packages/pipeline/src/` follows the same structure:
1. **Collector** — Fetches raw data from external API (Coinglass, Unbias, Binance)
2. **Analyzer** — Deterministic classification into regime states using thresholds/percentiles
3. **Agent** — LLM call (Claude) that interprets the analysis into natural language with context

Current dimensions: `derivatives_structure/`, `etfs/`, `htf/`, `sentiment/`, `exchange_flows/`

### Orchestrator (`packages/pipeline/src/orchestrator/`)

- `pipeline.ts` — Runs all dimensions in parallel (collect → analyze → agent), returns outputs
- `synthesizer.ts` — LLM-based text brief generation from dimension outputs
- `rich-synthesizer.ts` — Structured block format for visual dashboard display
- `delta.ts` — Calculates regime changes between runs
- `trade-idea/` — Trade idea synthesis, confluence scoring, outcome tracking
- `notify.ts` / `notify-run.ts` — Telegram delivery with resumable pipeline state
- `scheduler.ts` — Cron-based scheduling (hourly + 3x/day)

### Database (Prisma)

Schema at `packages/pipeline/prisma/schema.prisma`. Shared between pipeline and API via generated client.

Key models: `Brief`, dimension-specific models (`DerivativesDimension`, `EtfsDimension`, etc.), `DimensionState` (mutable regime tracker), `DimensionSnapshot` (time-series), `TradeIdea`, `NotifyRun` (resumable pipeline state).

The API package references the pipeline's Prisma schema: `prisma generate --schema=../pipeline/prisma/schema.prisma`.

### API

Hono framework with type-safe RPC. Routes in `packages/api/src/routes/`. The web package uses `hono/client` for type-safe API calls (`packages/web/app/lib/api.client.ts`).

### Web

React Router v7 framework mode with SSR. Routes defined in `packages/web/app/routes.ts`. Server-side data loading via React Router loaders that call the API.

## Key Technical Details

- **Runtime:** Node.js 22+, ESM throughout (`"type": "module"`)
- **TypeScript:** Strict mode, uses `tsx` for direct execution of `.ts` files (no compile step for pipeline)
- **LLM:** Claude Sonnet via `@anthropic-ai/sdk`, shared client in `packages/pipeline/src/llm.ts` with retry on 529 (overloaded)
- **Database:** PostgreSQL via Prisma v7 with `@prisma/adapter-pg`. PGlite fallback for local dev.
- **Cache:** Upstash Redis (REST API) with JSON file fallback
- **Regime types** are Prisma enums (e.g., `PositioningRegime`, `EtfRegime`, `HtfRegime`, `SentimentRegime`, `ExchangeFlowsRegime`)
- **No test suite** currently exists in the project
