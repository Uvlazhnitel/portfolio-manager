import { AccountType, AssetClass, AssetType, Prisma, TransactionType, type CachedMarketPrice } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { getContributionPlannerModel, previewContribution } from "@/features/contributions/read-model";
import { ContributionPlanService } from "@/features/contributions/service";
import { MarketDataService, resetMarketDataRuntimeCacheForTests } from "@/features/market-data/service";
import type { MarketDataStore } from "@/features/market-data/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;
let strategyId: string;
let marketDataService: MarketDataService;

const savedAllocations = [
  { assetClass: AssetClass.ETF, amount: "700.00" },
  { assetClass: AssetClass.CRYPTO, amount: "200.00" },
  { assetClass: AssetClass.GOLD, amount: "100.00" },
  { assetClass: AssetClass.CASH, amount: "0.00" },
];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const account = await testDb.prisma.account.create({ data: { name: "Main", type: AccountType.BROKER } });
  const asset = await testDb.prisma.asset.create({ data: { symbol: "VWCE", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" } });
  await testDb.prisma.transaction.create({ data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, quantity: "100", pricePerUnit: "10", currency: "EUR", executedAt: new Date("2026-08-01") } });
  const strategy = await testDb.prisma.strategy.create({
    data: {
      name: "Long-term growth",
      objective: "Growth",
      baseCurrency: "EUR",
      allocations: { create: [
        { assetClass: AssetClass.ETF, targetPercent: "70", minPercent: "60", maxPercent: "80" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "20" },
        { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15" },
        { assetClass: AssetClass.CASH, targetPercent: "5", minPercent: "0", maxPercent: "10" },
      ] },
    },
  });
  strategyId = strategy.id;
  const now = new Date();
  marketDataService = new MarketDataService(new PriceStore([{ id: "price", assetId: asset.id, currency: "EUR", price: new Prisma.Decimal("12"), timestamp: now, fetchedAt: now, source: "MANUAL", createdAt: now, updatedAt: now }]), []);
});

afterAll(async () => testDb.cleanup());

describe("contribution plan persistence and read model", () => {
  it("upserts only the latest snapshot without creating transactions", async () => {
    const service = new ContributionPlanService(new ContributionPlanRepository(testDb.prisma), new StrategyRepository(testDb.prisma));
    const beforeTransactions = await testDb.prisma.transaction.count();
    await service.save({ strategyId, currency: "EUR", contributionAmount: "1000.00", allocations: savedAllocations, isCustomized: true });
    await service.save({ strategyId, currency: "EUR", contributionAmount: "1200.00", allocations: savedAllocations.map((row) => ({ ...row, amount: row.assetClass === AssetClass.ETF ? "900.00" : row.amount })), isCustomized: true });

    expect(await testDb.prisma.contributionPlan.count()).toBe(1);
    expect((await testDb.prisma.contributionPlan.findUniqueOrThrow({ where: { strategyId } })).contributionAmount.toString()).toBe("1200");
    expect(await testDb.prisma.transaction.count()).toBe(beforeTransactions);
  });

  it("rejects invalid totals without overwriting the saved plan", async () => {
    const service = new ContributionPlanService(new ContributionPlanRepository(testDb.prisma), new StrategyRepository(testDb.prisma));
    await expect(service.save({ strategyId, currency: "EUR", contributionAmount: "1000.00", allocations: savedAllocations.map((row) => ({ ...row, amount: row.assetClass === AssetClass.CASH ? "1.00" : row.amount })), isCustomized: true })).rejects.toThrow("equal the contribution amount");
    expect((await testDb.prisma.contributionPlan.findUniqueOrThrow({ where: { strategyId } })).contributionAmount.toString()).toBe("1200");
  });

  it("restores the exact saved allocation and recalculates its current impact", async () => {
    resetMarketDataRuntimeCacheForTests();
    const model = await getContributionPlannerModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      planRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService,
    });
    expect(model.contributionAmount).toBe("1200");
    expect(model.allocations.find((row) => row.assetClass === AssetClass.ETF)?.amount).toBe("900.00");
    expect(model.projection?.plan.projectedAfter.totalValue).toBe("2400.00");
  });

  it("uses newly persisted strategy targets for subsequent previews", async () => {
    await testDb.prisma.strategyAllocation.update({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.ETF } }, data: { targetPercent: "60" } });
    await testDb.prisma.strategyAllocation.update({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.CRYPTO } }, data: { targetPercent: "25", maxPercent: "30" } });
    resetMarketDataRuntimeCacheForTests();
    const preview = await previewContribution({ contributionAmount: "1000" }, { portfolioRepository: new PortfolioRepository(testDb.prisma), strategyRepository: new StrategyRepository(testDb.prisma), marketDataService });
    expect(preview.projection.afterComparison.find((row) => row.assetClass === AssetClass.ETF)?.targetPercent).toBe("60.00");
    expect(preview.projection.afterComparison.find((row) => row.assetClass === AssetClass.CRYPTO)?.targetPercent).toBe("25.00");
  });

  it("plans and saves contributions without CASH when CASH is not active in the strategy", async () => {
    await testDb.prisma.contributionPlan.deleteMany({ where: { strategyId } });
    await testDb.prisma.strategyAllocation.update({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.ETF } }, data: { targetPercent: "78", minPercent: "70", maxPercent: "85" } });
    await testDb.prisma.strategyAllocation.update({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.CRYPTO } }, data: { targetPercent: "12", minPercent: "8", maxPercent: "20" } });
    await testDb.prisma.strategyAllocation.update({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.GOLD } }, data: { targetPercent: "10", minPercent: "5", maxPercent: "15" } });
    await testDb.prisma.strategyAllocation.delete({ where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.CASH } } });
    resetMarketDataRuntimeCacheForTests();

    const preview = await previewContribution({
      contributionAmount: "1000",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "780.00" },
        { assetClass: AssetClass.CRYPTO, amount: "120.00" },
        { assetClass: AssetClass.GOLD, amount: "100.00" },
      ],
    }, {
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      marketDataService,
    });

    expect(preview.recommendedAllocations.some((allocation) => allocation.assetClass === AssetClass.CASH)).toBe(false);
    expect(preview.projection.afterComparison.map((allocation) => allocation.assetClass).sort()).toEqual([
      AssetClass.CRYPTO,
      AssetClass.ETF,
      AssetClass.GOLD,
    ].sort());

    const service = new ContributionPlanService(new ContributionPlanRepository(testDb.prisma), new StrategyRepository(testDb.prisma));
    await service.save({
      strategyId,
      currency: "EUR",
      contributionAmount: "1000.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "780.00" },
        { assetClass: AssetClass.CRYPTO, amount: "120.00" },
        { assetClass: AssetClass.GOLD, amount: "100.00" },
      ],
      isCustomized: true,
    });

    const model = await getContributionPlannerModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      planRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService,
    });
    expect(model.strategy.allocations.map((allocation) => allocation.assetClass).sort()).toEqual([
      AssetClass.CRYPTO,
      AssetClass.ETF,
      AssetClass.GOLD,
    ].sort());
    expect(model.allocations.some((allocation) => allocation.assetClass === AssetClass.CASH)).toBe(false);
    await expect(service.save({
      strategyId,
      currency: "EUR",
      contributionAmount: "1000.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "779.00" },
        { assetClass: AssetClass.CRYPTO, amount: "120.00" },
        { assetClass: AssetClass.GOLD, amount: "100.00" },
        { assetClass: AssetClass.CASH, amount: "1.00" },
      ],
      isCustomized: true,
    })).rejects.toThrow("not enabled");
  });
});

class PriceStore implements MarketDataStore {
  constructor(private readonly prices: CachedMarketPrice[]) {}
  async listCachedPrices(assetIds: string[], currency: string) { return this.prices.filter((price) => assetIds.includes(price.assetId) && price.currency === currency); }
  async listManualPrices() { return []; }
  async saveCachedPrices() {}
}
