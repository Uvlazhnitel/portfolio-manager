# Portfolio Manager

A self-hosted, single-user investment portfolio manager and read-only wealth copilot.

The project is built around one idea: portfolio software should be deterministic, explicit about uncertainty, and useful for long-term allocation decisions without pretending to be a trading terminal or an oracle.

`/portfolio` is the primary app surface. It brings together current value, investment gain, tracked return, strategy status, risk summary, saved contribution plan, holdings, accounts, and transactions. `/` and `/dashboard` redirect to `/portfolio` for backwards compatibility.

## What it does

- Tracks assets, accounts, custodians, transactions, transfers, internal trades, deposits, withdrawals, gifts, and opening balances in PostgreSQL.
- Derives holdings from transaction history; holdings are not a separate editable source of truth.
- Calculates valuation, allocation, cost basis coverage, investment gain, risk, contribution plans, strategy compliance, and scenario projections through a deterministic Portfolio Engine.
- Preserves partial valuation semantics: if a held asset has no current price, the UI shows a known valued subtotal instead of pretending it knows the full portfolio value.
- Supports custom contribution plans and keeps saved custom allocations as the source of truth across Portfolio and Assistant.
- Provides a read-only AI Assistant powered by deterministic tools. The Assistant can explain, summarize, and simulate, but it cannot write transactions or execute trades.
- Stores current market prices and daily observations for performance history and benchmark comparison.
- Ships as an installable PWA with intentionally conservative offline behavior.

## Product surfaces

- **Portfolio** — app home; current value, gain, tracked return, strategy summary, risk summary, next contribution, holdings, accounts, and transactions.
- **Plan** — strategy allocation ranges and contribution planning.
- **Performance** — historical portfolio value, investment gain, cashflow-adjusted returns, XIRR, YTD, 1Y, max drawdown, and benchmark comparison. It remains available, but is no longer a top-level navigation item.
- **Intelligence** — portfolio intelligence/read-model surface for future analytical features.
- **Assistant** — read-only copilot with deterministic tools for portfolio facts, risk, performance, daily brief, contribution plans, and scenarios.
- **Settings** — market-data providers, API keys, manual prices, custodians, and risk settings.

## Financial semantics

This project deliberately favors explicitness over smooth-looking but misleading numbers.

### Portfolio value

`calculatePortfolio().totalValue` remains the engine's known valued subtotal for compatibility. Public read models expose clearer fields:

- `exactTotalValue` — full portfolio value when every held asset has a current price; otherwise `null`.
- `knownValuedSubtotal` — subtotal of holdings with known prices.
- `isPartial` and `missingPriceSymbols` — explain why the full value is unavailable.

When valuation is partial, allocation weights, strategy compliance, contribution planning, risk decisions, and scenarios stay unavailable or partial instead of being computed from incomplete data.

### Transactions and cashflows

- `BUY` and `SELL` represent standalone purchases/sales against external cash unless grouped as a trade.
- `TRADE` is an internal reallocation represented by a grouped source sell leg and destination buy leg.
- `TRANSFER` moves quantity and basis between accounts without changing portfolio value.
- `DEPOSIT` and `WITHDRAWAL` are external cashflows.
- `GIFT` and opening balances remain separate from net invested unless a reliable tracking basis exists.

Enter older transactions first. Sales, withdrawals, transfers, and internal trade source legs are validated against the selected account balance as of the historical execution date.

### Gain and return

- **Net invested** is standalone buy cost plus fees minus sell proceeds after fees.
- **Investment gain** is current known value minus reliably tracked capital components.
- **Return on tracked capital** uses only components with reliable basis coverage.
- **Cashflow-adjusted return** removes daily deposits and withdrawals using day-level observations. It is intentionally labelled this way because it is not strict intraday TWR when large same-day external cashflows occur.
- **XIRR** uses dated cashflows and remains unavailable until the covered period is long enough to avoid misleading annualization.

Daily Brief contributor rankings cover price movement on holdings present at the previous complete observation. Same-day purchases from new external cashflow can affect daily gain without appearing as individual contributors.

## Market data

Supported provider paths:

- CoinGecko for crypto prices and XAUT-referenced gold pricing.
- Alpha Vantage for ETF listing search, daily ETF quotes, and FX conversion.
- Twelve Data as an optional paid ETF quote provider.
- Manual prices as fallbacks where provider data is unavailable.

Provider credentials can be stored encrypted through Settings or supplied through environment variables. Database-stored credentials take precedence over environment fallbacks. The browser only receives provider status and masked key metadata, never complete secrets.

ETF quote identity currently uses provider symbol, MIC metadata, and currency. A fuller Fund/Listing/ISIN model is intentionally left for a future ETF intelligence migration.

## Assistant model

The Assistant uses OpenAI's Responses API and a compact runtime context. It gets authoritative facts through read-only deterministic tools:

- `get_portfolio_summary`
- `get_strategy`
- `get_daily_brief`
- `get_risk_snapshot`
- `get_performance_summary`
- `explain_contribution_plan`
- `simulate_scenario`

Scenario simulation is read-only. `TRADE` models internal reallocation, while `EXTERNAL_BUY`/legacy `BUY` and `CONTRIBUTION` inject external capital. If a user asks “buy BTC for $1,000” without naming a funding source, the Assistant should ask whether this is new money or an existing asset reallocation.

## Tech stack

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma 7
- PostgreSQL
- Tailwind CSS 4
- Recharts
- Vitest
- OpenAI SDK
- Docker Compose

## Architecture

The codebase is organized by feature:

```text
src/app/                    Next.js routes and page-level UI
src/components/             Shared layout and UI primitives
src/features/portfolio      Portfolio read models, actions, mutations, presentation
src/features/portfolio-engine
                            Pure deterministic financial calculations
src/features/contributions  Contribution planner persistence and helpers
src/features/performance    Daily history, performance read model, worker
src/features/risk           Risk rule configuration
src/features/assistant      Assistant runtime, tool schemas, tool execution
src/features/market-data    Provider-independent market-data service/cache
src/features/strategy       Strategy editor, rules, allocations
src/features/integrations   Encrypted provider credential management
prisma/                     Schema, migrations, seed
tests/                      Unit and integration regression tests
```

Repositories are the only layer that queries Prisma directly. Read models assemble data for pages/tools. The Portfolio Engine is pure and does not depend on React, Prisma, market providers, or an LLM.

## Getting started locally

### Prerequisites

- Node.js 24
- Corepack with `pnpm` 11
- PostgreSQL 15+ for local development

Install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Create an environment file:

```bash
cp .env.example .env
```

Generate an encryption key and place it in `APP_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

Create a local database and configure `DATABASE_URL`:

```bash
createdb portfolio_manager
```

Example local values:

```dotenv
DATABASE_URL="postgresql://localhost:5432/portfolio_manager?schema=public"
TEST_DATABASE_URL="postgresql://localhost:5432/postgres?schema=public"
APP_ENCRYPTION_KEY="..."
```

Apply migrations and seed baseline data:

```bash
pnpm db:migrate
pnpm db:seed
```

Start development:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The root route redirects to `/portfolio`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection for the app. |
| `TEST_DATABASE_URL` | For integration tests | Maintenance connection used to create isolated temporary test databases. |
| `APP_ENCRYPTION_KEY` | Strongly recommended | Base64-encoded 32-byte key for encrypting saved provider credentials. |
| `OPENAI_API_KEY` | Optional | Server fallback for Assistant. Without a DB or env key, Assistant shows setup state. |
| `OPENAI_MODEL` | Optional | Assistant model fallback; defaults to `gpt-5-mini`. |
| `COINGECKO_API_KEY` | Optional | CoinGecko fallback credential. Public API is used when no key exists. |
| `ALPHA_VANTAGE_API_KEY` | Optional | Alpha Vantage fallback for ETF search, daily quotes, and FX. |
| `TWELVE_DATA_API_KEY` | Optional | Twelve Data fallback for ETF search, quotes, and FX. |

Never prefix server secrets with `NEXT_PUBLIC_`, and never commit `.env`.

## Useful scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start Next.js development server. |
| `pnpm build` | Create a production Next.js build. |
| `pnpm start` | Start the production server after build. |
| `pnpm test` | Run Vitest regression tests. |
| `pnpm lint` | Run ESLint. |
| `pnpm typecheck` | Run TypeScript without emitting files. |
| `pnpm prisma:validate` | Validate Prisma schema. |
| `pnpm db:migrate` | Create/apply local development migrations. |
| `pnpm db:deploy` | Apply committed migrations in production. |
| `pnpm db:seed` | Run idempotent seed. |
| `pnpm db:studio` | Open Prisma Studio. |
| `pnpm history:capture` | Capture one daily market-price observation. |
| `pnpm history:worker` | Run the daily market-price worker. |
| `pnpm db:backup` | Create a Docker PostgreSQL backup under `backups/`. |
| `pnpm db:restore -- backups/file.dump --confirm portfolio_manager` | Restore a backup into the Compose database. |

Recommended quality gate before merging:

```bash
pnpm prisma:validate
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod --audit-level high
```

## Docker deployment

The bundled Compose stack runs:

- `postgres`
- `app`
- `history-worker`

Start or update it:

```bash
docker compose up -d --build
```

The app binds to [http://127.0.0.1:3010](http://127.0.0.1:3010). Container startup runs:

```bash
pnpm db:deploy
pnpm db:seed
pnpm start
```

The history worker captures prices immediately on startup, retries transient failures, and then records one observation per UTC day.

This application currently has no built-in authentication. Do not expose it directly to the public internet. Put it behind a trusted private network, VPN, reverse proxy with auth, or another access-control layer.

## Backup and restore

Backups use `pg_dump` from the running Compose `postgres` service and write a complete custom-format archive containing application data:

```bash
pnpm db:backup
pnpm db:backup -- backups/manual.dump
```

Restore is destructive and requires explicit confirmation:

```bash
pnpm db:restore -- backups/portfolio_manager_20260829_120000.dump --confirm portfolio_manager
```

Before replacing the database, restore validates the archive and creates a safety backup. If restore fails, the app remains stopped and the safety-backup path is printed.

Back up `APP_ENCRYPTION_KEY` separately in a password manager or secrets store. PostgreSQL backups contain encrypted integration credentials, but they cannot be decrypted without the same key.

## PWA and offline behavior

The production app is installable where the browser supports PWAs and the site is served over HTTPS. The manifest starts at `/portfolio`.

Offline caching is deliberately conservative. The service worker caches static assets and the offline fallback, but does not cache portfolio pages, API responses, Server Actions, or financial data. This prevents stale financial snapshots from looking current while the network is unavailable.

## Not implemented yet

- Authentication and multi-user support
- Broker/exchange sync
- Automated trades
- Tax calculations
- Push alerts
- News intelligence
- ETF constituent and overlap analysis
- Full Fund/Listing/ISIN identity model

## Safety note

This is decision-support software, not financial advice. All calculations should be treated as portfolio bookkeeping and planning aids. Verify critical numbers before acting on them.
