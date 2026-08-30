# Portfolio Manager

Single-user investment portfolio manager and decision-support copilot. The MVP focuses on long-term allocation, contribution-first rebalancing, and transparent deterministic calculations rather than trading.

## MVP FEATURES

- PostgreSQL-backed assets, accounts, transaction history, strategy, daily and current market prices, contribution plan, and assistant conversations.
- Holdings derived from transactions and initial balances; no manually editable Holding source of truth.
- Deterministic Portfolio Engine for holdings, valuation, allocation, strategy compliance, P&L availability, contribution planning, risk, and read-only scenario analysis.
- Editable class targets/ranges with optional nested asset targets; configured asset targets must total exactly 100%, while empty targets keep the class allocation intentionally asset-agnostic.
- CoinGecko pricing for crypto and XAUT-referenced physical gold, plus Alpha Vantage ETF search and automatic daily ETF quotes with USD conversion.
- Encrypted in-app API-key management for OpenAI, CoinGecko, Alpha Vantage, and Twelve Data with environment fallbacks.
- Portfolio, Dashboard, Strategy, Contribution Planner, Settings, and read-only AI Assistant screens.
- Historical Performance with daily portfolio value, deterministic TWR/XIRR, YTD and 1Y returns, observed max drawdown, and configurable benchmark comparison.
- OpenAI Responses API assistant with deterministic read-only tools for Daily Brief, Risk, Performance, contribution plans, and BUY/SELL/contribution scenarios.
- Responsive dark UI and installable PWA shell with conservative offline behavior.

## NOT IMPLEMENTED YET

- news intelligence
- ETF constituent analysis
- ETF overlap analysis
- automatic broker sync
- Bybit account sync
- automated trades
- tax calculations
- push alerts

## Architecture

The App Router pages call feature read models and server actions. Repositories are the only layer that queries Prisma. Portfolio calculations are pure and do not depend on React, market providers, or an LLM. Market providers return normalized prices through a provider-independent service and PostgreSQL cache. The AI Assistant receives only compact bootstrap metadata, then obtains authoritative facts through deterministic read-only tools; it cannot create transactions, persist scenarios, execute trades, or replace unavailable values with estimates.

Transactions and initial balances are the portfolio source of truth. Per-holding cost basis and P&L are shown only when they can be derived reliably in the base currency. Missing acquisition data, unsupported currencies, or ambiguous account transfers are reported as partial rather than estimated, with affected assets excluded from gain and return.

USD is the single MVP base currency. Transaction monetary values are stored in the currency recorded at entry and are never silently converted. USD cash is valued one-to-one; USDT is priced through CoinGecko. To hold EUR cash in a USD portfolio, configure a manual USD price per EUR unit in Settings. Physical gold is entered and displayed in troy ounces (`oz`, up to four decimal places), follows the CoinGecko XAUT price per troy ounce, and remains gram-normalized inside the deterministic engine. Manual gold quotes are fallback-only when XAUT and its cached price are unavailable.

ETF assets can be searched through Alpha Vantage global listings. The selected provider symbol, MIC metadata, and native currency identify the quote; native prices such as VWCE on Xetra in EUR are converted to USD through Alpha Vantage FX rates before entering the shared cache and daily history. Alpha Vantage ETF data is treated as daily/end-of-day data and cached conservatively to stay within free-tier limits. Twelve Data remains available as an optional paid exchange quote provider. Cached or manual ETF prices remain available when the provider is temporarily unavailable.

The Portfolio screen supports chronological current balances, trades, transfers, and external cashflows. Enter older transactions first. A sale, withdrawal, or transfer is checked against the selected account balance as of its historical date.

The Performance screen keeps trading capital, external cashflows, opening basis, and gift basis separate. Net invested is standalone `BUY` cost plus fees minus `SELL` proceeds after fees; internal Trades and Transfers are neutral. Only `DEPOSIT` and `WITHDRAWAL` are external cashflows. Gain and return on tracked capital use reliable cost-basis components, while TWR, XIRR, YTD/1Y, and observed max drawdown use complete valuations and deterministically valued external cashflows without depending on acquisition basis.

TWR chains UTC daily subperiod returns and removes contributions and withdrawals from each interval. XIRR uses Actual/365 dated cashflows, the first complete daily valuation as its opening boundary, and the current portfolio value as its terminal value. To avoid misleading annualization over a few days, XIRR remains unavailable until the covered period reaches 30 calendar days. YTD uses the latest observation on or before the prior 31 December; 1Y uses the latest observation on or before the clamped one-year UTC boundary. Metrics return an explicit unavailable reason when history, valuation, cashflow, or numerical coverage is insufficient.

The active strategy may reference one benchmark asset. The default strategy uses VWCE, but Performance can select any existing asset. Portfolio and benchmark comparison is normalized to 100 over their common observations; benchmark prices continue through the provider-independent market-data cache and daily history. A dedicated Docker worker stores one price observation per asset and UTC day from activation onward. Earlier portfolio or benchmark prices are never estimated or backfilled.

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
- `APP_ENCRYPTION_KEY` — base64-encoded 32-byte server secret used to encrypt API keys stored through Settings.
- `COINGECKO_API_KEY` — optional server-side fallback; the public CoinGecko API is used when no DB or environment key exists.
- `ALPHA_VANTAGE_API_KEY` — optional server-side fallback for free ETF listing search, daily quotes, and FX conversion.
- `TWELVE_DATA_API_KEY` — optional server-side fallback for ETF listing search, quotes, and FX conversion; Xetra requires Grow access.
- `OPENAI_API_KEY` — optional server-side fallback. Without a DB or environment key, `/assistant` shows a setup state.
- `OPENAI_MODEL` — optional model fallback; defaults server-side to `gpt-5-mini`.

Generate the encryption key once and place it in `.env` without printing it in application logs:

```bash
openssl rand -base64 32
```

After `APP_ENCRYPTION_KEY` is configured, OpenAI, CoinGecko, Alpha Vantage, and Twelve Data keys can be saved, replaced, tested, or deleted from `/settings` without restarting the app. Database credentials override environment credentials; deleting a database key restores the environment/public fallback. The browser receives only the credential source and final four characters, never the complete key.

Never prefix API keys with `NEXT_PUBLIC_` and never commit `.env`.

### Database commands

```bash
pnpm db:migrate   # create a development migration / apply local migrations
pnpm db:deploy    # apply committed migrations in production
pnpm db:backup    # full Docker PostgreSQL backup under backups/
pnpm db:restore -- backups/file.dump --confirm portfolio_manager
pnpm db:seed      # idempotent MVP seed
pnpm db:studio    # Prisma Studio
```

### Database backup and restore

The backup command uses `pg_dump` from the running Docker Compose `postgres` service and writes a complete custom-format archive containing all application data, including transactions, strategy, price history, settings, and integration records:

```bash
pnpm db:backup
pnpm db:backup -- backups/manual.dump
```

Backup files are stored under the git-ignored `backups/` directory by default. Existing files are never overwritten.

Restore is destructive and only targets the Compose database named `portfolio_manager`. It requires both an explicit archive path and the exact database confirmation:

```bash
pnpm db:restore -- backups/portfolio_manager_20260829_120000.dump --confirm portfolio_manager
```

Before replacing the database, restore validates the archive and creates an additional `portfolio_manager_before_restore_*.dump` safety backup. It stops `app` and `history-worker`, recreates the application database, restores the complete archive, and starts the services again. If restore fails, the application remains stopped and the safety-backup path is printed.

Back up `APP_ENCRYPTION_KEY` separately in a secure password manager or secrets store. It is not contained in PostgreSQL backups, and encrypted integration credentials restored from the database cannot be decrypted without the same key. Database dumps also do not include PostgreSQL cluster roles or other environment secrets.

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

The Compose stack runs both the web application and a lightweight history worker. The worker captures prices immediately on startup, retries transient failures, and then records one observation per UTC day.

The app listens on [http://localhost:3010](http://localhost:3010) only. Container startup runs `prisma migrate deploy`, the idempotent seed, and then Next.js. Use a private reverse proxy such as the existing tailnet-only Tailscale Serve endpoint for remote access. Change the example PostgreSQL credentials before any non-local deployment.

Back up `APP_ENCRYPTION_KEY` separately together with PostgreSQL backups. Encrypted integration keys cannot be recovered from the database without the same master key. Rotating the master key requires re-saving provider credentials.

This MVP intentionally has no authentication. Do not expose it to the public internet; use a trusted private network until authentication is implemented.

## PWA and offline behavior

The production app is installable where the browser supports PWAs and the site is served over HTTPS. It uses a standalone manifest, local icons, safe-area-aware mobile navigation, and a dedicated offline screen.

Offline caching is deliberately conservative: the service worker caches only local static assets and the offline fallback. It does not cache portfolio pages, API responses, Server Actions, or financial/market data. Cached market prices retain timestamps and stale status.

Test the service worker with a production build:

```bash
pnpm build
pnpm start
```
