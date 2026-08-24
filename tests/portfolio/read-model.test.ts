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
  const [btc, gold] = await Promise.all([
    testDb.prisma.asset.create({
      data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    }),
    testDb.prisma.asset.create({
      data: { symbol: "PHYSICAL_GOLD", name: "Physical Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "XAU" },
    }),
  ]);
  await testDb.prisma.transaction.createMany({ data: [
    { accountId: account.id, assetId: btc.id, type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: "40000", currency: "EUR", executedAt: new Date("2026-08-01") },
    { accountId: account.id, assetId: gold.id, type: TransactionType.INITIAL_BALANCE, quantity: "10", pricePerUnit: "80", currency: "EUR", executedAt: new Date("2026-08-01") },
  ] });
  const strategy = await testDb.prisma.strategy.create({
    data: { name: "Test", objective: "Test", baseCurrency: "EUR" },
  });
  await testDb.prisma.strategyAllocation.createMany({ data: [
    { strategyId: strategy.id, assetClass: AssetClass.ETF, targetPercent: "70", minPercent: "60", maxPercent: "80" },
    { strategyId: strategy.id, assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "20" },
    { strategyId: strategy.id, assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15" },
    { strategyId: strategy.id, assetClass: AssetClass.CASH, targetPercent: "5", minPercent: "0", maxPercent: "10" },
  ] });

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
  it("calculates holding values, P&L, and weights including physical gold grams", async () => {
    resetMarketDataRuntimeCacheForTests();
    const model = await getPortfolioReadModel({
      repository: new PortfolioRepository(testDb.prisma),
      marketDataService,
    });
    const btc = model.holdings.find((holding) => holding.symbol === "BTC");
    const gold = model.holdings.find((holding) => holding.symbol === "PHYSICAL_GOLD");

    expect(model.valuation.totalValue).toBe("51000.00");
    expect(model.valuation.isPartial).toBe(false);
    expect(btc).toEqual(expect.objectContaining({ currentValue: "50000.00", pnl: "10000.00", portfolioWeight: "98.04" }));
    expect(gold).toEqual(expect.objectContaining({ quantityLabel: "10 g", currentValue: "1000.00", pnl: "200.00", priceSource: "MANUAL" }));
  });

  it("builds dashboard totals and strategy comparison from engine results", async () => {
    resetMarketDataRuntimeCacheForTests();
    const dashboard = await getDashboardReadModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      marketDataService,
    });

    expect(dashboard.totalValue).toBe("51000.00");
    expect(dashboard.comparisons).toHaveLength(4);
    expect(dashboard.suggestedAssetClass).toBe(AssetClass.ETF);
    expect(dashboard.isPartial).toBe(false);
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
