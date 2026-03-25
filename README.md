# Market Intelligence

A crypto market intelligence engine for **BTC** and **ETH**. Collects data from APIs, applies deterministic analysis, and uses LLM agents to reason about what matters — delivered as concise briefs 3x/day + a live dashboard.

This is an **information system**, not a trading bot. It surfaces what's happening, what's unusual, and why it might matter — you do the thinking.

## How It Works

```mermaid
graph LR
    S[Scheduler] -->|hourly + 3x/day| C[Collector]
    C -->|raw snapshots| A[Analyzer]
    A -->|regime state +<br/>multi-TF context| R[Agent Runner<br/>18 agents x 2 assets]
    R -->|agent outputs| O[Orchestrator]
    O -->|brief| DB[(DB)]
    DB --> T[Telegram]
    DB --> D[Dashboard]
```

**Code computes, LLMs reason.** Deterministic rules detect regimes and flag anomalies. LLM agents interpret what it means in context. An orchestrator synthesizes everything into a scannable brief.

## 18 Data Dimensions

| # | Dimension | # | Dimension |
|---|-----------|---|-----------|
| 01 | Derivatives Structure | 10 | Geopolitics & News |
| 02 | Options & IV | 11 | Cross-Market Correlations |
| 03 | Institutional Flows (ETFs) | 12 | Prediction Markets |
| 04 | Exchange Flows | 13 | Stablecoin Flows |
| 05 | Whale Activity | 14 | DeFi Activity |
| 06 | Market Sentiment | 15 | Token Unlocks |
| 07 | HTF Technical Structure | 16 | BTC Mining (BTC only) |
| 08 | LTF Technical Structure | 17 | ETH Staking & Network (ETH only) |
| 09 | Macro Environment | 18 | Equities Market Structure |

## Setup

```bash
pnpm install
cp .env.example .env  # fill in your keys
pnpm db:client        # generate Prisma client
```

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (API response cache) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `ANTHROPIC_API_KEY` | Anthropic API key (agent interpretations & synthesis) |
| `COINGLASS_API_KEY` | Coinglass API key (derivatives data) |
| `UNBIAS_API_KEY` | Unbias API key (sentiment data) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (notifications) |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID (notifications) |

## Scripts

| Command | Description |
|---|---|
| `pnpm derivatives` | Run derivatives structure analysis (BTC) |
| `pnpm etfs` | Run ETF institutional flows analysis |
| `pnpm htf` | Run high-timeframe technical analysis |
| `pnpm sentiment` | Run market sentiment analysis |
| `pnpm brief` | Run all dimensions and synthesize a market brief |
| `pnpm notify` | Run full brief pipeline and send to Telegram |
| `pnpm db:client` | Regenerate Prisma client after schema changes |

Most scripts accept `--asset BTC` or `--asset ETH` to target a specific asset (default: both).

## Stack

Prisma · PostgreSQL · Upstash Redis · Claude API · sharp · Telegram Bot API

## Docs

- [About](docs/about.md) — what this is, why it exists, architecture, roadmap
- [Technical Spec](docs/technical_spec.md) — stack, pipeline, dependencies, deployment
- [Data Dimensions](docs/data_dimensions.md) — all 17 dimensions with signals, regime states, and data sources
