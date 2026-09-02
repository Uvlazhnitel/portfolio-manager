import { AccountType, AssetClass, AssetType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { getDashboardReadModel } from "@/features/dashboard/read-model";
import { MarketDataService } from "@/features/market-data/service";
import type { DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";

const allocations = [
  { assetClass: AssetClass.ETF, targetPercent: new Prisma.Decimal(70), minPercent: new Prisma.Decimal(60), maxPercent: new Prisma.Decimal(80) },
  { assetClass: AssetClass.CRYPTO, targetPercent: new Prisma.Decimal(15), minPercent: new Prisma.Decimal(10), maxPercent: new Prisma.Decimal(20) },
  { assetClass: AssetClass.GOLD, targetPercent: new Prisma.Decimal(10), minPercent: new Prisma.Decimal(5), maxPercent: new Prisma.Decimal(15) },
  { assetClass: AssetClass.CASH, targetPercent: new Prisma.Decimal(5), minPercent: new Prisma.Decimal(0), maxPercent: new Prisma.Decimal(10) },
];

describe("dashboard read model edge states", () => {
  it("returns a deliberate empty state without inventing a score or P&L", async () => {
    const dashboard = await getDashboardReadModel({
      portfolioRepository: fakePortfolio([], [], []),
      strategyRepository: fakeStrategy(),
      contributionPlanRepository: fakePlan(),
      marketDataService: fakeMarketData([]),
      dailyPriceStore: fakeDailyPrices([]),
    });

    expect(dashboard.valuation).toEqual(expect.objectContaining({ totalValue: "0.00", exactTotalValue: "0.00", knownValuedSubtotal: "0.00" }));
    expect(dashboard.valuation.investmentGain).toBe("0.00");
    expect(dashboard.strategyStatus.state).toBe("EMPTY");
    expect(dashboard.history.points).toEqual([]);
  });

  it("supports a portfolio without ETF and preserves partial account value", async () => {
    const now = new Date("2026-08-25T08:00:00Z");
    const account = { id: "account", name: "Mixed", type: AccountType.OTHER, description: null, createdAt: now, updatedAt: now };
    const btc = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const gold = { id: "gold", symbol: "GOLD", name: "Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "XAU", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const transactions = [btc, gold].map((asset, index) => ({
      id: `transaction-${asset.id}`,
      assetId: asset.id,
      accountId: account.id,
      type: TransactionType.INITIAL_BALANCE,
      quantity: new Prisma.Decimal(index === 0 ? 1 : 10),
      pricePerUnit: new Prisma.Decimal(index === 0 ? 5 : 50),
      fee: null,
      currency: "EUR",
      executedAt: new Date(now.getTime() + index * 1000),
      note: null,
      createdAt: now,
      updatedAt: now,
      asset,
      account,
    }));
    const dashboard = await getDashboardReadModel({
      portfolioRepository: fakePortfolio([btc, gold], [account], transactions),
      strategyRepository: fakeStrategy(),
      contributionPlanRepository: fakePlan(),
      marketDataService: fakeMarketData([{ assetId: btc.id, symbol: btc.symbol, price: "10.00", currency: "EUR", timestamp: now, fetchedAt: now, source: "TEST", isStale: false }]),
      dailyPriceStore: fakeDailyPrices([
        dailyPrice(btc.id, "2026-08-25", "9"),
        dailyPrice(gold.id, "2026-08-25", "2"),
        dailyPrice(btc.id, "2026-08-26", "10"),
        dailyPrice(gold.id, "2026-08-26", "3", true),
      ]),
    });

    expect(dashboard.valuation).toEqual(expect.objectContaining({
      totalValue: "10.00",
      exactTotalValue: null,
      knownValuedSubtotal: "10.00",
      isPartial: true,
      investmentGain: "5.00",
      isCostBasisPartial: true,
    }));
    expect(dashboard.allocation).toEqual({
      state: "PARTIAL",
      reasonCodes: ["INCOMPLETE_VALUATION", "MISSING_MARKET_PRICE"],
      missingPriceSymbols: ["GOLD"],
      rows: [],
    });
    expect(dashboard.strategyStatus).toEqual(expect.objectContaining({
      state: "UNAVAILABLE",
      attentionCount: null,
      missingPriceSymbols: ["GOLD"],
    }));
    expect(dashboard.contribution).toEqual(expect.objectContaining({
      state: "UNAVAILABLE",
      projection: null,
      missingPriceSymbols: ["GOLD"],
    }));
    expect(dashboard.history.points).toHaveLength(2);
    expect(dashboard.history.points.map((point) => point.portfolioValue)).toEqual(["29.00", "40.00"]);
    expect(dashboard.history.trackingStartedAt).toBe("2026-08-25");
    expect(dashboard.history.incompleteDates).toBe(0);
    expect(dashboard.history.staleDates).toBe(1);
  });

  it("exposes stale prices and partial cost basis without hiding the portfolio value", async () => {
    const now = new Date("2026-08-26T08:00:00Z");
    const account = { id: "account", name: "Wallet", type: AccountType.OTHER, description: null, createdAt: now, updatedAt: now };
    const btc = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const transaction = {
      id: "transaction",
      assetId: btc.id,
      accountId: account.id,
      type: TransactionType.INITIAL_BALANCE,
      quantity: new Prisma.Decimal(1),
      pricePerUnit: null,
      fee: null,
      currency: "EUR",
      executedAt: now,
      note: null,
      createdAt: now,
      updatedAt: now,
      asset: btc,
      account,
    };
    const dashboard = await getDashboardReadModel({
      portfolioRepository: fakePortfolio([btc], [account], [transaction]),
      strategyRepository: fakeStrategy(),
      contributionPlanRepository: fakePlan(),
      marketDataService: fakeMarketData(
        [{ assetId: btc.id, symbol: btc.symbol, price: "100.00", currency: "EUR", timestamp: now, fetchedAt: now, source: "TEST", isStale: true }],
        { hasStalePrices: true, warning: "Cached price in use." },
      ),
      dailyPriceStore: fakeDailyPrices([]),
    });

    expect(dashboard.valuation).toEqual(expect.objectContaining({ totalValue: "100.00", exactTotalValue: "100.00", knownValuedSubtotal: "100.00" }));
    expect(dashboard.valuation.isPartial).toBe(false);
    expect(dashboard.valuation.isCostBasisPartial).toBe(true);
    expect(dashboard.valuation.missingCostBasisSymbols).toEqual(["BTC"]);
    expect(dashboard.valuation.hasStalePrices).toBe(true);
    expect(dashboard.valuation.warning).toBe("Cached price in use.");
  });
});

function fakePortfolio(assets: unknown[], accounts: unknown[], transactions: unknown[]) {
  return {
    listAssets: async () => assets,
    listAccounts: async () => accounts,
    listTransactions: async () => transactions,
  } as unknown as PortfolioRepository;
}

function fakeStrategy() {
  return {
    findActiveStrategy: async () => ({
      id: "strategy",
      name: "Test strategy",
      objective: "Growth",
      baseCurrency: "EUR",
      createdAt: new Date(),
      updatedAt: new Date(),
      allocations: allocations.map((allocation, index) => ({ id: `allocation-${index}`, strategyId: "strategy", ...allocation })),
      portfolioRules: [],
    }),
  } as unknown as StrategyRepository;
}

function fakePlan() {
  return { findByStrategyId: async () => null } as unknown as ContributionPlanRepository;
}

function fakeMarketData(prices: unknown[], options: { hasStalePrices?: boolean; warning?: string | null } = {}) {
  return {
    getCurrentPrices: async () => ({
      prices,
      unavailableAssetIds: [],
      lastUpdated: null,
      hasStalePrices: options.hasStalePrices ?? false,
      wasRefreshed: false,
      refreshBlockedUntil: null,
      warning: options.warning ?? null,
    }),
  } as unknown as MarketDataService;
}

function fakeDailyPrices(rows: unknown[]) {
  return {
    listDailyPrices: async () => rows,
    saveDailyPrices: async () => undefined,
  } as unknown as DailyMarketPriceStore;
}

function dailyPrice(assetId: string, date: string, price: string, isStaleAtCapture = false) {
  const timestamp = new Date(`${date}T20:00:00Z`);
  return {
    id: `${assetId}-${date}`,
    assetId,
    currency: "EUR",
    date: new Date(`${date}T00:00:00Z`),
    price: new Prisma.Decimal(price),
    source: "TEST",
    quoteTimestamp: timestamp,
    capturedAt: timestamp,
    isStaleAtCapture,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
