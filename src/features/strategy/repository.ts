import { PortfolioRuleType, type AssetClass, type PrismaClient } from "@prisma/client";
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

  updateStrategy(input: {
    id: string;
    name: string;
    allocations: Array<{
      assetClass: AssetClass;
      targetPercent: string;
      minPercent: string;
      maxPercent: string;
    }>;
    rules: {
      preferContributionsOverSelling: boolean;
      challengeStrategyViolations: boolean;
      preferNoActionWhenEvidenceWeak: boolean;
      minimumRebalanceDrift: string;
    };
  }) {
    return this.db.$transaction(async (transaction) => {
      const strategy = await transaction.strategy.update({
        where: { id: input.id },
        data: { name: input.name },
      });

      for (const allocation of input.allocations) {
        await transaction.strategyAllocation.upsert({
          where: {
            strategyId_assetClass: {
              strategyId: strategy.id,
              assetClass: allocation.assetClass,
            },
          },
          update: {
            targetPercent: allocation.targetPercent,
            minPercent: allocation.minPercent,
            maxPercent: allocation.maxPercent,
          },
          create: {
            strategyId: strategy.id,
            ...allocation,
          },
        });
      }

      const booleanRules = [
        {
          type: PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING,
          enabled: input.rules.preferContributionsOverSelling,
        },
        {
          type: PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS,
          enabled: input.rules.challengeStrategyViolations,
        },
        {
          type: PortfolioRuleType.PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK,
          enabled: input.rules.preferNoActionWhenEvidenceWeak,
        },
      ];

      for (const rule of booleanRules) {
        await transaction.portfolioRule.upsert({
          where: { strategyId_type: { strategyId: strategy.id, type: rule.type } },
          update: { enabled: rule.enabled },
          create: { strategyId: strategy.id, type: rule.type, enabled: rule.enabled, config: {} },
        });
      }

      await transaction.portfolioRule.upsert({
        where: {
          strategyId_type: {
            strategyId: strategy.id,
            type: PortfolioRuleType.MIN_REBALANCE_DRIFT,
          },
        },
        update: {
          enabled: true,
          config: { minDriftPercent: input.rules.minimumRebalanceDrift },
        },
        create: {
          strategyId: strategy.id,
          type: PortfolioRuleType.MIN_REBALANCE_DRIFT,
          enabled: true,
          config: { minDriftPercent: input.rules.minimumRebalanceDrift },
        },
      });

      await transaction.portfolioRule.deleteMany({
        where: { strategyId: strategy.id, type: PortfolioRuleType.CRYPTO_MAX_ALLOCATION },
      });

      return transaction.strategy.findUniqueOrThrow({
        where: { id: strategy.id },
        include: strategyInclude,
      });
    });
  }
}
