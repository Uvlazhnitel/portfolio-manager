# Portfolio Manager

Single-user investment portfolio manager and decision-support copilot. The MVP focuses on long-term allocation, contribution-first rebalancing, and transparent deterministic calculations rather than trading.

## MVP FEATURES

- PostgreSQL-backed assets, accounts, complete Buy/Sell/Current Balance transaction history, strategy, market-price cache, contribution plan, and assistant conversations.
- Holdings derived from transactions and initial balances; no manually editable Holding source of truth.
- Deterministic Portfolio Engine for holdings, valuation, allocation, strategy compliance, P&L availability, contribution planning, and assistant transaction checks.
- Editable ETF, Crypto, Gold, and Cash targets/ranges with exact 100% target validation.
- CoinGecko adapter for supported crypto, XAUT-referenced physical-gold valuation, USD base-currency valuation, manual fallback prices, persistent cache, and stale indicators.
- Encrypted in-app API-key management for OpenAI and CoinGecko with environment fallbacks.
- Portfolio, Dashboard, Strategy, Contribution Planner, Settings, and read-only AI Assistant screens.
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

The App Router pages call feature read models and server actions. Repositories are the only layer that queries Prisma. Portfolio calculations are pure and do not depend on React, market providers, or an LLM. Market providers return normalized prices through a provider-independent service and PostgreSQL cache. The AI Assistant receives compact pre-calculated context and can call only deterministic read-only tools; it cannot create transactions or execute trades.

Transactions and initial balances are the portfolio source of truth. Per-holding cost basis and P&L are shown only when they can be derived reliably in the base currency. Missing acquisition data, unsupported currencies, or ambiguous account transfers are reported as unavailable rather than estimated.

USD is the single MVP base currency. Transaction monetary values are stored in the currency recorded at entry and are never silently converted. USD cash is valued one-to-one; USDT is priced through CoinGecko. To hold EUR cash in a USD portfolio, configure a manual USD price per EUR unit in Settings. Physical gold is entered and displayed in troy ounces (`oz`, up to four decimal places), follows the CoinGecko XAUT price per troy ounce, and remains gram-normalized inside the deterministic engine. Manual gold quotes are fallback-only when XAUT and its cached price are unavailable.

The Portfolio screen supports chronological `Current balance`, `Buy`, and `Sell` entry. For Buy/Sell, enter either price per unit or the gross total; fees are stored separately. Enter older transactions first. A sale is checked against the selected account balance as of its historical date, and a required earlier purchase cannot be deleted while a later sale depends on it.

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
- `OPENAI_API_KEY` — optional server-side fallback. Without a DB or environment key, `/assistant` shows a setup state.
- `OPENAI_MODEL` — optional model fallback; defaults server-side to `gpt-5-mini`.

Generate the encryption key once and place it in `.env` without printing it in application logs:

```bash
openssl rand -base64 32
```

After `APP_ENCRYPTION_KEY` is configured, OpenAI and CoinGecko keys can be saved, replaced, tested, or deleted from `/settings` without restarting the app. Database credentials override environment credentials; deleting a database key restores the environment/public fallback. The browser receives only the credential source and final four characters, never the complete key.

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
