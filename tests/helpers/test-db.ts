import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const migrationsDirectory = path.join(process.cwd(), "prisma/migrations");
  for (const migration of readdirSync(migrationsDirectory).sort()) {
    const migrationPath = path.join(migrationsDirectory, migration, "migration.sql");
    if (!existsSync(migrationPath)) {
      continue;
    }
    await client.query(readFileSync(migrationPath, "utf8"));
  }
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
