import { PortfolioRuleType, type AssetClass, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const strategyInclude = {
  allocations: {
    include: {
      assetAllocations: {
        include: { asset: true },
        orderBy: { assetId: "asc" },
      },
    },
  },
  portfolioRules: true,
  benchmarkAsset: true,
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

  async updateBenchmark(strategyId: string, benchmarkAssetId: string | null) {
    return this.db.$transaction(async (transaction) => {
      if (benchmarkAssetId) {
        const asset = await transaction.asset.findUnique({ where: { id: benchmarkAssetId }, select: { id: true } });
        if (!asset) throw new Error("Benchmark asset does not exist.");
      }

      return transaction.strategy.update({
        where: { id: strategyId },
        data: { benchmarkAssetId },
        include: strategyInclude,
      });
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
      assetTargets: Array<{
        assetId: string;
        targetPercent: string;
      }>;
    }>;
    rules: {
      preferContributionsOverSelling: boolean;
      challengeStrategyViolations: boolean;
      preferNoActionWhenEvidenceWeak: boolean;
      minimumRebalanceDrift: string;
      singleAssetLimitEnabled?: boolean;
      singleAssetMaxPercent?: string;
      custodianLimitEnabled?: boolean;
      custodianMaxPercent?: string;
    };
  }) {
    return this.db.$transaction(async (transaction) => {
      const strategy = await transaction.strategy.update({
        where: { id: input.id },
        data: { name: input.name },
      });

      const requestedAssetIds = [...new Set(input.allocations.flatMap((allocation) => allocation.assetTargets.map((target) => target.assetId)))];
      const assets = await transaction.asset.findMany({ where: { id: { in: requestedAssetIds } } });
      const assetById = new Map(assets.map((asset) => [asset.id, asset]));

      for (const allocation of input.allocations) {
        for (const assetTarget of allocation.assetTargets) {
          const asset = assetById.get(assetTarget.assetId);
          if (!asset) {
            throw new Error(`${allocation.assetClass} asset target references an unknown asset.`);
          }
          if (asset.assetClass !== allocation.assetClass) {
            throw new Error(`${asset.symbol} must match parent ${allocation.assetClass} allocation.`);
          }
        }

        const savedAllocation = await transaction.strategyAllocation.upsert({
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
            assetClass: allocation.assetClass,
            targetPercent: allocation.targetPercent,
            minPercent: allocation.minPercent,
            maxPercent: allocation.maxPercent,
          },
        });

        await transaction.strategyAssetAllocation.deleteMany({
          where: {
            strategyAllocationId: savedAllocation.id,
            assetId: { notIn: allocation.assetTargets.map((target) => target.assetId) },
          },
        });

        for (const assetTarget of allocation.assetTargets) {
          await transaction.strategyAssetAllocation.upsert({
            where: {
              strategyAllocationId_assetId: {
                strategyAllocationId: savedAllocation.id,
                assetId: assetTarget.assetId,
              },
            },
            update: { targetPercent: assetTarget.targetPercent },
            create: {
              strategyAllocationId: savedAllocation.id,
              assetId: assetTarget.assetId,
              targetPercent: assetTarget.targetPercent,
            },
          });
        }
      }

      await transaction.strategyAllocation.deleteMany({
        where: {
          strategyId: strategy.id,
          assetClass: { notIn: input.allocations.map((allocation) => allocation.assetClass) },
        },
      });

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

      for (const rule of [
        { type: PortfolioRuleType.SINGLE_ASSET_MAX_ALLOCATION, enabled: input.rules.singleAssetLimitEnabled ?? false, maxPercent: input.rules.singleAssetMaxPercent ?? "100" },
        { type: PortfolioRuleType.CUSTODIAN_MAX_ALLOCATION, enabled: input.rules.custodianLimitEnabled ?? false, maxPercent: input.rules.custodianMaxPercent ?? "100" },
      ]) {
        await transaction.portfolioRule.upsert({
          where: { strategyId_type: { strategyId: strategy.id, type: rule.type } },
          update: { enabled: rule.enabled, config: { maxPercent: rule.maxPercent } },
          create: { strategyId: strategy.id, type: rule.type, enabled: rule.enabled, config: { maxPercent: rule.maxPercent } },
        });
      }

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
