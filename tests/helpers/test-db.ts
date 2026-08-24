import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

export type TestDatabase = {
  prisma: PrismaClient;
  databaseUrl: string;
  cleanup: () => Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const databaseName = `portfolio_manager_test_${randomUUID().replaceAll("-", "_")}`;
  const maintenanceUrl = process.env.TEST_DATABASE_MAINTENANCE_URL ?? "postgresql://uvlazhnitel@localhost:5432/postgres";
  const databaseUrl = `postgresql://uvlazhnitel@localhost:5432/${databaseName}?schema=public`;

  execFileSync("createdb", [databaseName], { stdio: "ignore" });

  const migrationSql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20260824231000_init_portfolio_mvp/migration.sql"),
    "utf8",
  );
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(migrationSql);
  await client.end();

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  return {
    prisma,
    databaseUrl,
    cleanup: async () => {
      await prisma.$disconnect();
      const maintenanceClient = new pg.Client({ connectionString: maintenanceUrl });
      await maintenanceClient.connect();
      await maintenanceClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await maintenanceClient.end();
    },
  };
}
