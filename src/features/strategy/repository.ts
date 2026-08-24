import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const strategyInclude = {
  allocations: true,
  portfolioRules: true,
} as const;

export class StrategyRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findActiveStrategy() {
    return this.db.strategy.findFirst({
      include: strategyInclude,
      orderBy: { createdAt: "asc" },
    });
  }

  createStrategy(data: Parameters<PrismaClient["strategy"]["create"]>[0]["data"]) {
    return this.db.strategy.create({
      data,
      include: strategyInclude,
    });
  }
}
