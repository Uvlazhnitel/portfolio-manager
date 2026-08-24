# Portfolio Manager

Personal investment portfolio manager and wealth copilot. The MVP is single-user, dark-first, and focused on long-term allocation rather than trading.

## Development setup

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to your PostgreSQL database.

Create the local PostgreSQL database if it does not exist yet:

```bash
createdb portfolio_manager
```

Run Prisma migrations:

```bash
pnpm db:migrate
```

Seed the MVP data:

```bash
pnpm db:seed
```

Open Prisma Studio when you want to inspect the database:

```bash
pnpm db:studio
```

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The root route redirects to `/dashboard`.

Run checks:

```bash
pnpm prisma:validate
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The dashboard still uses temporary demo values. Database-backed portfolio data will be wired into the UI in a later task.

## Docker deployment

Build and run the app with PostgreSQL:

```bash
docker compose up -d --build
```

The app starts on [http://localhost:3000](http://localhost:3000). On container start it runs Prisma migrations and the seed script before starting Next.js.
