import {
  AccountType,
  AssetClass,
  AssetType,
  BasisMethod,
  Prisma,
  TransactionType,
  type CachedMarketPrice,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDashboardReadModel } from "@/features/dashboard/read-model";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import type { MarketDataStore } from "@/features/market-data/repository";
import { MarketDataService, resetMarketDataRuntimeCacheForTests } from "@/features/market-data/service";
import { DailyMarketPriceRepository } from "@/features/performance/repository";
import { getPortfolioReadModel } from "@/features/portfolio/read-model";
import { createTradeMutation, createTransferMutation, deleteTransactionGroupMutation } from "@/features/portfolio/mutations";
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
    { accountId: account.id, assetId: btc.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "1", pricePerUnit: "40000", currency: "EUR", executedAt: new Date("2026-08-01") },
    { accountId: account.id, assetId: gold.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "10", pricePerUnit: "80", currency: "EUR", executedAt: new Date("2026-08-01") },
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
  it("exposes explicit basis methods in transaction history", async () => {
    resetMarketDataRuntimeCacheForTests();
    const model = await getPortfolioReadModel({ repository: new PortfolioRepository(testDb.prisma), strategyRepository: new StrategyRepository(testDb.prisma), marketDataService });
    expect(model.transactions.filter((row) => row.type === TransactionType.INITIAL_BALANCE)).not.toHaveLength(0);
    expect(model.transactions.filter((row) => row.type === TransactionType.INITIAL_BALANCE).every((row) => row.basisMethod === BasisMethod.KNOWN_COST)).toBe(true);
  });

  it("collapses linked transfers and trades into logical operations", async () => {
    const main = await testDb.prisma.account.findUniqueOrThrow({ where: { name: "Main" } });
    const empty = await testDb.prisma.account.findUniqueOrThrow({ where: { name: "Empty" } });
    const btc = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const eur = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "EUR" } });
    await createTransferMutation({ assetId: btc.id, fromAccountId: main.id, toAccountId: empty.id, quantity: "0.1", currency: "EUR", executedAt: new Date("2026-08-06") }, testDb.prisma);
    await createTradeMutation({ sourceAccountId: main.id, sourceAssetId: btc.id, sourceQuantity: "0.1", destinationAccountId: empty.id, destinationAssetId: eur.id, destinationQuantity: "5000", fee: "1", currency: "EUR", executedAt: new Date("2026-08-07") }, testDb.prisma);
    const groups = await testDb.prisma.transactionGroup.findMany({ where: { transactions: { some: { accountId: main.id, executedAt: { gte: new Date("2026-08-06") } } } } });
    try {
      resetMarketDataRuntimeCacheForTests();
      const model = await getPortfolioReadModel({ repository: new PortfolioRepository(testDb.prisma), strategyRepository: new StrategyRepository(testDb.prisma), marketDataService });
      const grouped = model.transactions.filter((row) => row.groupId && groups.some((group) => group.id === row.groupId));
      expect(grouped).toHaveLength(2);
      expect(grouped.map((row) => row.operationKind).sort()).toEqual(["TRADE", "TRANSFER"]);
      expect(grouped.every((row) => row.destination)).toBe(true);
    } finally {
      for (const group of groups.reverse()) await deleteTransactionGroupMutation(group.id, testDb.prisma);
    }
  });

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
    expect(btc).toEqual(expect.objectContaining({
      currentPrice: "50000.00",
      displayPriceUnit: "unit",
      currentValue: "50000.00",
      averageAcquisitionPrice: "40000",
      accountingAverageCost: "40000",
      averageNetCost: "39998",
      netCost: "39998.00",
      pnl: "10000.00",
      netPnl: "10002.00",
      portfolioWeight: "98.04",
    }));
    expect(gold).toEqual(expect.objectContaining({
      quantityLabel: "0.3215 oz",
      currentPrice: "3110.35",
      displayPriceUnit: "troy oz",
      averageAcquisitionPrice: "2488.278144",
      accountingAverageCost: "2488.278144",
      averageNetCost: "2488.278144",
      netCost: "800.00",
      currentValue: "1000.00",
      pnl: "200.00",
      netPnl: "200.00",
      priceSource: "MANUAL",
    }));
    const goldTransaction = model.transactions.find((transaction) => transaction.symbol === "PHYSICAL_GOLD");
    expect(goldTransaction).toEqual(expect.objectContaining({
      quantityLabel: "0.3215 oz",
      inputQuantity: expect.stringMatching(/^0\.3215/),
      displayPricePerUnit: "2488.278144",
      displayPriceUnit: "troy oz",
    }));
  });

  it("exposes per-asset daily price history and replaces today's saved point with the current quote", async () => {
    const btc = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const gold = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "PHYSICAL_GOLD" } });
    const currentQuote = await testDb.prisma.cachedMarketPrice.findFirst();
    const currentDate = currentQuote?.timestamp ?? new Date();
    const today = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()));
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const capturedAt = new Date(today.getTime() + 12 * 60 * 60 * 1000);

    await testDb.prisma.dailyMarketPrice.createMany({
      data: [
        { assetId: btc.id, currency: "EUR", date: yesterday, price: "48000", source: "HISTORY", quoteTimestamp: capturedAt, capturedAt, isStaleAtCapture: false },
        { assetId: btc.id, currency: "EUR", date: today, price: "49000", source: "HISTORY", quoteTimestamp: capturedAt, capturedAt, isStaleAtCapture: false },
        { assetId: gold.id, currency: "EUR", date: yesterday, price: "90", source: "HISTORY", quoteTimestamp: capturedAt, capturedAt, isStaleAtCapture: true },
      ],
    });

    try {
      resetMarketDataRuntimeCacheForTests();
      const model = await getPortfolioReadModel({
        repository: new PortfolioRepository(testDb.prisma),
        strategyRepository: new StrategyRepository(testDb.prisma),
        marketDataService,
      });
      const btcHistory = model.assetPriceHistory.find((entry) => entry.assetId === btc.id);
      const goldHistory = model.assetPriceHistory.find((entry) => entry.assetId === gold.id);

      expect(btcHistory?.points).toHaveLength(2);
      expect(btcHistory?.points.at(-1)).toEqual(expect.objectContaining({
        date: today.toISOString().slice(0, 10),
        price: "50000",
        source: "COINGECKO",
      }));
      expect(goldHistory?.points[0]).toEqual(expect.objectContaining({
        price: "2799.312912",
        isStale: true,
      }));
      expect(goldHistory?.points.at(-1)?.price).toBe("3110.34768");
    } finally {
      await testDb.prisma.dailyMarketPrice.deleteMany({ where: { assetId: { in: [btc.id, gold.id] } } });
    }
  });

  it("hides every portfolio weight and strategy decision when one held asset has no price", async () => {
    const btc = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    const now = new Date();
    resetMarketDataRuntimeCacheForTests();
    const partialMarketData = new MarketDataService(new ReadModelPriceStore([
      makeCachedPrice(btc.id, "50000", now, "COINGECKO"),
    ]), []);
    const model = await getPortfolioReadModel({
      repository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      marketDataService: partialMarketData,
    });

    expect(model.valuation).toEqual(expect.objectContaining({
      totalValue: "50000.00",
      isPartial: true,
      missingPriceSymbols: ["PHYSICAL_GOLD"],
    }));
    expect(model.holdings.every((holding) => holding.portfolioWeight === null)).toBe(true);
    expect(model.strategyStatus).toEqual(expect.objectContaining({
      state: "UNAVAILABLE",
      inRangeCount: null,
      comparisons: [],
      missingPriceSymbols: ["PHYSICAL_GOLD"],
    }));
  });

  it("builds dashboard totals and strategy comparison from engine results", async () => {
    resetMarketDataRuntimeCacheForTests();
    const dashboard = await getDashboardReadModel({
      portfolioRepository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      contributionPlanRepository: new ContributionPlanRepository(testDb.prisma),
      marketDataService,
      dailyPriceStore: new DailyMarketPriceRepository(testDb.prisma),
    });

    expect(dashboard.valuation.totalValue).toBe("51000.00");
    expect(dashboard.valuation.investmentGain).toBe("10202.00");
    expect(dashboard.allocation.state).toBe("AVAILABLE");
    expect(dashboard.allocation.rows).toHaveLength(4);
    expect(dashboard.valuation.isPartial).toBe(false);
    expect(dashboard.contribution.amount).toBe("1000");
    expect(dashboard.contribution.projection?.plan.contributionAmount).toBe("1000.00");
    expect(dashboard.contribution.projection?.plan.assetRecommendations.length).toBeGreaterThan(0);
    expect(dashboard.history.points).toEqual([]);
    expect(dashboard.allocation.rows[0]).toEqual(expect.objectContaining({ assetClass: AssetClass.CRYPTO, driftPercent: "83.04" }));
    expect(dashboard.strategyStatus.state).toBe("NEEDS_ATTENTION");
    expect(dashboard.strategyStatus.attentionCount).toBe(3);
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
