import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export class ContributionPlanRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findByStrategyId(strategyId: string) {
    return this.db.contributionPlan.findUnique({ where: { strategyId } });
  }

  upsert(input: {
    strategyId: string;
    contributionAmount: string;
    currency: string;
    allocations: Prisma.InputJsonValue;
    isCustomized: boolean;
  }) {
    const data = {
      contributionAmount: input.contributionAmount,
      currency: input.currency,
      allocations: input.allocations,
      isCustomized: input.isCustomized,
    };
    return this.db.contributionPlan.upsert({
      where: { strategyId: input.strategyId },
      update: data,
      create: { strategyId: input.strategyId, ...data },
    });
  }
}
