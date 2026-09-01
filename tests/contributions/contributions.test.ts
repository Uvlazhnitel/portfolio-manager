import { AccountType, AssetClass, AssetType, BasisMethod, Prisma, TransactionType, type CachedMarketPrice } from "@prisma/client";
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
let targetAssets: Record<AssetClass, string>;

const savedAllocations = [
  { assetClass: AssetClass.ETF, amount: "700.00" },
  { assetClass: AssetClass.CRYPTO, amount: "200.00" },
  { assetClass: AssetClass.GOLD, amount: "100.00" },
  { assetClass: AssetClass.CASH, amount: "0.00" },
];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const account = await testDb.prisma.account.create({ data: { name: "Main", type: AccountType.BROKER } });
  const [asset, btc, xaut, eur] = await Promise.all([
    testDb.prisma.asset.create({ data: { symbol: "VWCE", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" } }),
    testDb.prisma.asset.create({ data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" } }),
    testDb.prisma.asset.create({ data: { symbol: "XAUT", name: "Tether Gold", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD, currency: "XAUT" } }),
    testDb.prisma.asset.create({ data: { symbol: "EUR", name: "Euro", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" } }),
  ]);
  targetAssets = {
    [AssetClass.ETF]: asset.id,
    [AssetClass.CRYPTO]: btc.id,
    [AssetClass.GOLD]: xaut.id,
    [AssetClass.CASH]: eur.id,
    [AssetClass.OTHER]: eur.id,
  };
  await testDb.prisma.transaction.create({ data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "100", pricePerUnit: "10", currency: "EUR", executedAt: new Date("2026-08-01") } });
  const strategy = await testDb.prisma.strategy.create({
    data: {
      name: "Long-term growth",
      objective: "Growth",
      baseCurrency: "EUR",
      allocations: { create: [
        allocationCreate(AssetClass.ETF, "70", "60", "80"),
        allocationCreate(AssetClass.CRYPTO, "15", "10", "20"),
        allocationCreate(AssetClass.GOLD, "10", "5", "15"),
        allocationCreate(AssetClass.CASH, "5", "0", "10"),
      ] },
    },
  });
  strategyId = strategy.id;
  const now = new Date();
  marketDataService = new MarketDataService(new PriceStore([{ id: "price", assetId: asset.id, currency: "EUR", price: new Prisma.Decimal("12"), timestamp: now, fetchedAt: now, source: "MANUAL", createdAt: now, updatedAt: now }]), []);
});

function allocationCreate(assetClass: AssetClass, targetPercent: string, minPercent: string, maxPercent: string) {
  return {
    assetClass,
    targetPercent,
    minPercent,
    maxPercent,
    assetAllocations: {
      create: [{ assetId: targetAssets[assetClass], targetPercent: "100" }],
    },
  };
}

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
    expect(preview.projection).not.toBeNull();
    if (!preview.projection) throw new Error("Expected an available contribution projection.");
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
    expect(preview.projection).not.toBeNull();
    if (!preview.projection) throw new Error("Expected an available contribution projection.");

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

  it("returns class-only allocations alongside targeted asset recommendations", async () => {
    const etfAllocation = await testDb.prisma.strategyAllocation.findUniqueOrThrow({
      where: { strategyId_assetClass: { strategyId, assetClass: AssetClass.ETF } },
    });
    await testDb.prisma.strategyAssetAllocation.deleteMany({ where: { strategyAllocationId: etfAllocation.id } });
    resetMarketDataRuntimeCacheForTests();

    const preview = await previewContribution(
      { contributionAmount: "1000" },
      {
        portfolioRepository: new PortfolioRepository(testDb.prisma),
        strategyRepository: new StrategyRepository(testDb.prisma),
        marketDataService,
      },
    );
    expect(preview.projection).not.toBeNull();
    if (!preview.projection) throw new Error("Expected an available contribution projection.");
    const model = await getContributionPlannerModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      planRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService,
      preferredAmount: "1000",
    });

    expect(preview.projection.plan.allocations).toContainEqual(expect.objectContaining({ assetClass: AssetClass.ETF }));
    expect(preview.projection.plan.assetRecommendations.some((item) => item.assetClass === AssetClass.ETF)).toBe(false);
    expect(preview.projection.plan.assetRecommendations.some((item) => item.assetClass === AssetClass.CRYPTO || item.assetClass === AssetClass.GOLD)).toBe(true);
    expect(model.strategy.allocations.find((allocation) => allocation.assetClass === AssetClass.ETF)?.hasAssetTargets).toBe(false);
    expect(model.setupError).toBeNull();
  });

  it("preserves the saved plan but blocks recommendations when current valuation is partial", async () => {
    resetMarketDataRuntimeCacheForTests();
    const unavailableMarketData = new MarketDataService(new PriceStore([]), []);
    const dependencies = {
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      planRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService: unavailableMarketData,
    };

    const model = await getContributionPlannerModel(dependencies);
    const preview = await previewContribution({ contributionAmount: "1000" }, dependencies);

    expect(model.contributionAmount).toBe("1000");
    expect(model.availability).toEqual({
      state: "UNAVAILABLE",
      reasonCodes: ["INCOMPLETE_VALUATION", "MISSING_MARKET_PRICE"],
      missingPriceSymbols: ["VWCE"],
    });
    expect(model.projection).toBeNull();
    expect(preview).toEqual(expect.objectContaining({
      projection: null,
      recommendedAllocations: [],
      availability: expect.objectContaining({ state: "UNAVAILABLE", missingPriceSymbols: ["VWCE"] }),
    }));
    expect(await testDb.prisma.contributionPlan.findUnique({ where: { strategyId } })).not.toBeNull();
  });
});

class PriceStore implements MarketDataStore {
  constructor(private readonly prices: CachedMarketPrice[]) {}
  async listCachedPrices(assetIds: string[], currency: string) { return this.prices.filter((price) => assetIds.includes(price.assetId) && price.currency === currency); }
  async listManualPrices() { return []; }
  async saveCachedPrices() {}
}
