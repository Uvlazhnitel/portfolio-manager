import { AccountType, AssetClass, AssetType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { getDashboardReadModel } from "@/features/dashboard/read-model";
import { MarketDataService } from "@/features/market-data/service";
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
    });

    expect(dashboard.valuation.totalValue).toBe("0.00");
    expect(dashboard.valuation.totalUnrealizedPnl).toBeNull();
    expect(dashboard.alignment.score).toBeNull();
    expect(dashboard.strategyStatus.state).toBe("EMPTY");
    expect(dashboard.recentActivity).toEqual([]);
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
    });

    expect(dashboard.valuation).toEqual(expect.objectContaining({ totalValue: "10.00", isPartial: true, totalUnrealizedPnl: null }));
    expect(dashboard.allocation.find((item) => item.assetClass === AssetClass.ETF)?.currentPercent).toBe("0.00");
    expect(dashboard.accounts).toContainEqual(expect.objectContaining({ name: "Mixed", value: "10.00", isPartial: true }));
    expect(dashboard.recentActivity).toHaveLength(2);
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

function fakeMarketData(prices: unknown[]) {
  return {
    getCurrentPrices: async () => ({
      prices,
      unavailableAssetIds: [],
      lastUpdated: null,
      hasStalePrices: false,
      wasRefreshed: false,
      refreshBlockedUntil: null,
      warning: null,
    }),
  } as unknown as MarketDataService;
}
