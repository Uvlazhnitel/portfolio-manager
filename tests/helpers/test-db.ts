import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  const configuredUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL must point to a PostgreSQL server for integration tests.");
  }
  const configured = new URL(configuredUrl);
  if (!configured.username) {
    const databaseUser = process.env.PGUSER ?? process.env.USER;
    if (!databaseUser) throw new Error("TEST_DATABASE_URL must include a PostgreSQL username.");
    configured.username = databaseUser;
  }
  const maintenance = new URL(configured);
  maintenance.pathname = "/postgres";
  maintenance.search = "";
  const database = new URL(configured);
  database.pathname = `/${databaseName}`;
  database.searchParams.set("schema", "public");
  const maintenanceUrl = maintenance.toString();
  const databaseUrl = database.toString();

  const maintenanceClient = new pg.Client({ connectionString: maintenanceUrl });
  await maintenanceClient.connect();
  await maintenanceClient.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
  await maintenanceClient.end();

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "ignore",
  });

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
