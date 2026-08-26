import {
  AccountType,
  AssetClass,
  AssetType,
  Prisma,
  TransactionType,
  type CachedMarketPrice,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDashboardReadModel } from "@/features/dashboard/read-model";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import type { MarketDataStore } from "@/features/market-data/repository";
import { MarketDataService, resetMarketDataRuntimeCacheForTests } from "@/features/market-data/service";
import { getPortfolioReadModel } from "@/features/portfolio/read-model";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;
let marketDataService: MarketDataService;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const account = await testDb.prisma.account.create({ data: { name: "Main", type: AccountType.OTHER } });
  await testDb.prisma.account.create({ data: { name: "Empty", type: AccountType.BANK } });
  const [btc, gold, etf, eur] = await Promise.all([
    testDb.prisma.asset.create({
      data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    }),
    testDb.prisma.asset.create({
      data: { symbol: "PHYSICAL_GOLD", name: "Physical Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "XAU" },
    }),
    testDb.prisma.asset.create({
      data: { symbol: "VWCE", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" },
    }),
    testDb.prisma.asset.create({
      data: { symbol: "EUR", name: "Euro", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" },
    }),
  ]);
  await testDb.prisma.transaction.createMany({ data: [
    { accountId: account.id, assetId: btc.id, type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: "40000", currency: "EUR", executedAt: new Date("2026-08-01") },
    { accountId: account.id, assetId: gold.id, type: TransactionType.INITIAL_BALANCE, quantity: "10", pricePerUnit: "80", currency: "EUR", executedAt: new Date("2026-08-01") },
    { accountId: account.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0.0001", pricePerUnit: "40000", currency: "EUR", executedAt: new Date("2026-08-02") },
    { accountId: account.id, assetId: btc.id, type: TransactionType.SELL, quantity: "0.0001", pricePerUnit: "50000", currency: "EUR", executedAt: new Date("2026-08-03") },
    { accountId: account.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0.0001", pricePerUnit: "40000", currency: "EUR", executedAt: new Date("2026-08-04") },
    { accountId: account.id, assetId: btc.id, type: TransactionType.SELL, quantity: "0.0001", pricePerUnit: "50000", currency: "EUR", executedAt: new Date("2026-08-05") },
  ] });
  const strategy = await testDb.prisma.strategy.create({
    data: { name: "Test", objective: "Test", baseCurrency: "EUR" },
  });
  for (const allocation of [
    { assetClass: AssetClass.ETF, targetPercent: "70", minPercent: "60", maxPercent: "80", assetId: etf.id },
    { assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "20", assetId: btc.id },
    { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15", assetId: gold.id },
    { assetClass: AssetClass.CASH, targetPercent: "5", minPercent: "0", maxPercent: "10", assetId: eur.id },
  ]) {
    await testDb.prisma.strategyAllocation.create({
      data: {
        strategyId: strategy.id,
        assetClass: allocation.assetClass,
        targetPercent: allocation.targetPercent,
        minPercent: allocation.minPercent,
        maxPercent: allocation.maxPercent,
        assetAllocations: { create: [{ assetId: allocation.assetId, targetPercent: "100" }] },
      },
    });
  }
  await testDb.prisma.contributionPlan.create({ data: {
    strategyId: strategy.id,
    contributionAmount: "1000",
    currency: "EUR",
    allocations: [],
    isCustomized: false,
  } });

  const now = new Date();
  marketDataService = new MarketDataService(new ReadModelPriceStore([
    makeCachedPrice(btc.id, "50000", now, "COINGECKO"),
    makeCachedPrice(gold.id, "100", now, "MANUAL"),
  ]), []);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("priced portfolio read models", () => {
  it("keeps gram-based valuation while presenting physical gold in troy ounces", async () => {
    resetMarketDataRuntimeCacheForTests();
    const model = await getPortfolioReadModel({
      repository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      marketDataService,
    });
    const btc = model.holdings.find((holding) => holding.symbol === "BTC");
    const gold = model.holdings.find((holding) => holding.symbol === "PHYSICAL_GOLD");

    expect(model.valuation.totalValue).toBe("51000.00");
    expect(model.valuation.isPartial).toBe(false);
    expect(model.strategyStatus?.totalCount).toBe(4);
    expect(btc).toEqual(expect.objectContaining({ currentValue: "50000.00", pnl: "10000.00", portfolioWeight: "98.04" }));
    expect(gold).toEqual(expect.objectContaining({
      quantityLabel: "0.3215 oz",
      currentPrice: "3110.35",
      averageAcquisitionPrice: "2488.278144",
      currentValue: "1000.00",
      pnl: "200.00",
      priceSource: "MANUAL",
    }));
    const goldTransaction = model.transactions.find((transaction) => transaction.symbol === "PHYSICAL_GOLD");
    expect(goldTransaction).toEqual(expect.objectContaining({
      quantityLabel: "0.3215 oz",
      displayPricePerUnit: "2488.278144",
      displayPriceUnit: "troy oz",
    }));
  });

  it("builds dashboard totals and strategy comparison from engine results", async () => {
    resetMarketDataRuntimeCacheForTests();
    const dashboard = await getDashboardReadModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      contributionPlanRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService,
    });

    expect(dashboard.valuation.totalValue).toBe("51000.00");
    expect(dashboard.valuation.totalUnrealizedPnl).toBe("10200.00");
    expect(dashboard.allocation).toHaveLength(4);
    expect(dashboard.valuation.isPartial).toBe(false);
    expect(dashboard.contribution.amount).toBe("1000");
    expect(dashboard.contribution.projection?.plan.contributionAmount).toBe("1000.00");
    expect(dashboard.recentActivity).toHaveLength(5);
    expect(dashboard.recentActivity[0].executedAt).toContain("2026-08-05");
    expect(dashboard.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Main", value: "51000.00", isPartial: false }),
      expect.objectContaining({ name: "Empty", value: "0.00", isPartial: false }),
    ]));
    expect(dashboard.alignment.score).toBe(40);
    expect(dashboard.strategyStatus.state).toBe("NEEDS_ATTENTION");
  });
});

class ReadModelPriceStore implements MarketDataStore {
  constructor(private readonly prices: CachedMarketPrice[]) {}
  async listCachedPrices(assetIds: string[], currency: string) {
    return this.prices.filter((price) => assetIds.includes(price.assetId) && price.currency === currency);
  }
  async listManualPrices() { return []; }
  async saveCachedPrices() {}
}

function makeCachedPrice(assetId: string, price: string, timestamp: Date, source: string): CachedMarketPrice {
  return {
    id: `price-${assetId}`,
    assetId,
    currency: "EUR",
    price: new Prisma.Decimal(price),
    timestamp,
    fetchedAt: timestamp,
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
