import { PortfolioRuleType, type AssetClass, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { runInTransaction } from "@/lib/db/transaction";
import type { DbClient } from "@/lib/db/types";

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
  constructor(private readonly db: DbClient = prisma) {}

  async withTransaction<T>(operation: (repository: StrategyRepository) => Promise<T>) {
    if (typeof (this.db as PrismaClient).$transaction !== "function") {
      throw new Error("A root Prisma client is required to start a transaction.");
    }
    return runInTransaction(this.db as PrismaClient, (transaction) => (
      operation(new StrategyRepository(transaction))
    ));
  }

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

  updateBenchmark(strategyId: string, benchmarkAssetId: string | null) {
    return this.db.strategy.update({
      where: { id: strategyId },
      data: { benchmarkAssetId },
      include: strategyInclude,
    });
  }

  findAssets(ids: string[]) {
    return this.db.asset.findMany({ where: { id: { in: ids } } });
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
    return (async () => {
      const strategy = await this.db.strategy.update({
        where: { id: input.id },
        data: { name: input.name },
      });

      for (const allocation of input.allocations) {
        const savedAllocation = await this.db.strategyAllocation.upsert({
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

        await this.db.strategyAssetAllocation.deleteMany({
          where: allocation.assetTargets.length === 0
            ? { strategyAllocationId: savedAllocation.id }
            : {
                strategyAllocationId: savedAllocation.id,
                assetId: { notIn: allocation.assetTargets.map((target) => target.assetId) },
              },
        });

        for (const assetTarget of allocation.assetTargets) {
          await this.db.strategyAssetAllocation.upsert({
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

      await this.db.strategyAllocation.deleteMany({
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
        await this.db.portfolioRule.upsert({
          where: { strategyId_type: { strategyId: strategy.id, type: rule.type } },
          update: { enabled: rule.enabled },
          create: { strategyId: strategy.id, type: rule.type, enabled: rule.enabled, config: {} },
        });
      }

      await this.db.portfolioRule.upsert({
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
        await this.db.portfolioRule.upsert({
          where: { strategyId_type: { strategyId: strategy.id, type: rule.type } },
          update: { enabled: rule.enabled, config: { maxPercent: rule.maxPercent } },
          create: { strategyId: strategy.id, type: rule.type, enabled: rule.enabled, config: { maxPercent: rule.maxPercent } },
        });
      }

      await this.db.portfolioRule.deleteMany({
        where: { strategyId: strategy.id, type: PortfolioRuleType.CRYPTO_MAX_ALLOCATION },
      });

      return this.db.strategy.findUniqueOrThrow({
        where: { id: strategy.id },
        include: strategyInclude,
      });
    })();
  }

  getAssetTargetBackfillSnapshot() {
    return Promise.all([
      this.db.strategy.findMany({
        include: { allocations: { include: { assetAllocations: true } } },
      }),
      this.db.asset.findMany(),
      this.db.transaction.findMany(),
      this.db.cachedMarketPrice.findMany(),
      this.db.manualMarketPrice.findMany(),
    ]).then(([strategies, assets, transactions, cachedPrices, manualPrices]) => ({
      strategies,
      assets,
      transactions,
      cachedPrices,
      manualPrices,
    }));
  }

  createAssetTargets(input: Array<{
    strategyAllocationId: string;
    assetId: string;
    targetPercent: string;
  }>) {
    return this.db.strategyAssetAllocation.createMany({ data: input, skipDuplicates: true });
  }
}
