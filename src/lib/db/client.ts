import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize PrismaClient.");
  }

  const adapter = new PrismaPg(databaseUrl);

  return new PrismaClient({ adapter });
}

export function getPrismaClient() {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = getPrismaClient()[property as keyof PrismaClient];

    if (typeof value === "function") {
      return value.bind(getPrismaClient());
    }

    return value;
  },
});
