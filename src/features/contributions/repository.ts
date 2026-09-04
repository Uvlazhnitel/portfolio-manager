import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DbClient } from "@/lib/db/types";

export class ContributionPlanRepository {
  constructor(private readonly db: DbClient = prisma) {}

  findByStrategyId(strategyId: string) {
    return this.db.contributionPlan.findUnique({ where: { strategyId } });
  }

  upsert(input: {
    strategyId: string;
    contributionAmount: string;
    currency: string;
    allocations: Array<{ assetClass: string; amount: string }>;
    isCustomized: boolean;
  }) {
    const data = {
      contributionAmount: input.contributionAmount,
      currency: input.currency,
      allocations: input.allocations as Prisma.InputJsonValue,
      isCustomized: input.isCustomized,
    };
    return this.db.contributionPlan.upsert({
      where: { strategyId: input.strategyId },
      update: data,
      create: { strategyId: input.strategyId, ...data },
    });
  }
}
