# Portfolio Manager

Single-user investment portfolio manager and decision-support copilot. The MVP focuses on long-term allocation, contribution-first rebalancing, transparent deterministic calculations, and advisory simulations rather than trading.

## MVP FEATURES

- PostgreSQL-backed assets, accounts, transactions, strategy, market-price cache, contribution plan, and assistant conversations.
- Holdings derived from transactions and initial balances; no manually editable Holding source of truth.
- Deterministic Portfolio Engine for holdings, valuation, allocation, strategy compliance, P&L availability, contribution planning, and simulations.
- Editable ETF, Crypto, Gold, and Cash targets/ranges with exact 100% target validation.
- CoinGecko adapter for supported crypto, EUR base-currency valuation, manual prices, physical-gold gram/troy-ounce normalization, persistent cache, and stale indicators.
- Portfolio, Dashboard, Strategy, Contribution Planner, Scenarios, Settings, and read-only AI Assistant screens.
- OpenAI Responses API assistant with compact trusted portfolio context and deterministic read-only tools.
- Responsive dark UI and installable PWA shell with conservative offline behavior.

## NOT IMPLEMENTED YET

- news intelligence
- ETF constituent analysis
- ETF overlap analysis
- automatic broker sync
- Bybit account sync
- automated trades
- tax calculations
- advanced historical performance
- push alerts

## Architecture

The App Router pages call feature read models and server actions. Repositories are the only layer that queries Prisma. Portfolio and scenario calculations are pure and do not depend on React, market providers, or an LLM. Market providers return normalized prices through a provider-independent service and PostgreSQL cache. The AI Assistant receives compact pre-calculated context and can call only deterministic read-only tools; it cannot create transactions or execute trades.

Transactions and initial balances are the portfolio source of truth. Per-holding cost basis and P&L are shown only when they can be derived reliably in the base currency. Missing acquisition data, unsupported currencies, or ambiguous account transfers are reported as unavailable rather than estimated.

## Development setup

### Prerequisites

- Node.js 24 (the Docker image uses Node 24)
- Corepack and `pnpm` 11
- PostgreSQL 15 or newer

Enable the package manager and install the exact locked dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Create the environment file:

```bash
cp .env.example .env
```

Create a local database and set `DATABASE_URL` in `.env`:

```bash
createdb portfolio_manager
```

Example URLs for a peer-authenticated local PostgreSQL installation:

```dotenv
DATABASE_URL="postgresql://localhost:5432/portfolio_manager?schema=public"
TEST_DATABASE_URL="postgresql://localhost:5432/postgres?schema=public"
```

Include username/password in these URLs when your PostgreSQL installation requires them. `TEST_DATABASE_URL` must point to a server account allowed to create temporary databases; integration tests create isolated randomly named databases and remove them afterward.

Apply development migrations and seed the reference assets/accounts/strategy:

```bash
pnpm db:migrate
pnpm db:seed
```

The seed is idempotent. Re-running it adds missing reference records without resetting customized strategy allocations or rules.

Start development:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). `/` redirects to `/dashboard`.

### Environment variables

- `DATABASE_URL` — required server-side PostgreSQL connection.
- `TEST_DATABASE_URL` — PostgreSQL maintenance connection used only by integration tests.
- `COINGECKO_API_KEY` — optional server-side CoinGecko Demo API key; public API fallback is used when empty.
- `OPENAI_API_KEY` — optional and server-side only. Without it, `/assistant` shows a setup state.
- `OPENAI_MODEL` — optional; defaults server-side to `gpt-5-mini`.

Never prefix API keys with `NEXT_PUBLIC_` and never commit `.env`.

### Database commands

```bash
pnpm db:migrate   # create a development migration / apply local migrations
pnpm db:deploy    # apply committed migrations in production
pnpm db:seed      # idempotent MVP seed
pnpm db:studio    # Prisma Studio
```

### Verification

Run the complete quality gate before committing:

```bash
pnpm prisma:validate
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod --audit-level high
```

Pure unit tests do not require a database. Integration tests use `TEST_DATABASE_URL`; when it is absent they try local PostgreSQL peer authentication at `localhost:5432` without assuming a username.

## Production and Docker

For a non-Docker production process:

```bash
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm db:seed
pnpm build
pnpm start
```

For the bundled app/PostgreSQL stack:

```bash
docker compose up -d --build
```

The app is available at [http://localhost:3010](http://localhost:3010). Container startup runs `prisma migrate deploy`, the idempotent seed, and then Next.js. Change the example PostgreSQL credentials before any non-local deployment.

This MVP intentionally has no authentication. Do not expose it to the public internet; use a trusted private network until authentication is implemented.

## PWA and offline behavior

The production app is installable where the browser supports PWAs and the site is served over HTTPS. It uses a standalone manifest, local icons, safe-area-aware mobile navigation, and a dedicated offline screen.

Offline caching is deliberately conservative: the service worker caches only local static assets and the offline fallback. It does not cache portfolio pages, API responses, Server Actions, or financial/market data. Cached market prices retain timestamps and stale status.

Test the service worker with a production build:

```bash
pnpm build
pnpm start
```
