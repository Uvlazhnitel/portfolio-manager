import { AccountType, AssetClass, AssetType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { MarketDataService } from "@/features/market-data/service";
import { getPortfolioReadModel } from "@/features/portfolio/read-model";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";

const allocations = [
  { assetClass: AssetClass.ETF, targetPercent: new Prisma.Decimal(70), minPercent: new Prisma.Decimal(60), maxPercent: new Prisma.Decimal(80) },
  { assetClass: AssetClass.CRYPTO, targetPercent: new Prisma.Decimal(15), minPercent: new Prisma.Decimal(10), maxPercent: new Prisma.Decimal(20) },
  { assetClass: AssetClass.GOLD, targetPercent: new Prisma.Decimal(10), minPercent: new Prisma.Decimal(5), maxPercent: new Prisma.Decimal(15) },
  { assetClass: AssetClass.CASH, targetPercent: new Prisma.Decimal(5), minPercent: new Prisma.Decimal(0), maxPercent: new Prisma.Decimal(10) },
];

describe("portfolio home read model edge states", () => {
  it("preserves partial account value without allocation, risk, or contribution decisions", async () => {
    const now = new Date("2026-08-25T08:00:00Z");
    const account = { id: "account", name: "Mixed", type: AccountType.OTHER, description: null, custodianId: null, custodian: null, createdAt: now, updatedAt: now };
    const btc = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const gold = { id: "gold", symbol: "GOLD", name: "Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "XAU", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const transactions = [btc, gold].map((asset, index) => ({
      id: `transaction-${asset.id}`,
      assetId: asset.id,
      accountId: account.id,
      groupId: null,
      transactionGroupId: null,
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: null,
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
      transactionGroup: null,
    }));

    const portfolio = await getPortfolioReadModel({
      repository: fakePortfolio([btc, gold], [account], transactions),
      strategyRepository: fakeStrategy(),
      contributionPlanRepository: fakePlan(),
      marketDataService: fakeMarketData([{ assetId: btc.id, symbol: btc.symbol, price: "10.00", currency: "EUR", timestamp: now, fetchedAt: now, source: "TEST", isStale: false }]),
    });

    expect(portfolio.valuation).toEqual(expect.objectContaining({
      totalValue: "10.00",
      exactTotalValue: null,
      knownValuedSubtotal: "10.00",
      isPartial: true,
      missingPriceSymbols: ["GOLD"],
      investmentGain: "5.00",
      isCostBasisPartial: true,
    }));
    expect(portfolio.holdings.every((holding) => holding.portfolioWeight === null)).toBe(true);
    expect(portfolio.strategyStatus).toEqual(expect.objectContaining({
      state: "UNAVAILABLE",
      inRangeCount: null,
      comparisons: [],
      missingPriceSymbols: ["GOLD"],
    }));
    expect(portfolio.risk).toEqual(expect.objectContaining({
      state: "PARTIAL",
      missingPriceSymbols: ["GOLD"],
      violations: [],
    }));
    expect(portfolio.contribution).toEqual(expect.objectContaining({
      state: "UNAVAILABLE",
      projection: null,
      missingPriceSymbols: ["GOLD"],
    }));
  });

  it("exposes stale prices and partial cost basis without hiding exact known valuation", async () => {
    const now = new Date("2026-08-26T08:00:00Z");
    const account = { id: "account", name: "Wallet", type: AccountType.OTHER, description: null, custodianId: null, custodian: null, createdAt: now, updatedAt: now };
    const btc = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: null, metadata: null, createdAt: now, updatedAt: now };
    const transaction = {
      id: "transaction",
      assetId: btc.id,
      accountId: account.id,
      groupId: null,
      transactionGroupId: null,
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: null,
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
      transactionGroup: null,
    };

    const portfolio = await getPortfolioReadModel({
      repository: fakePortfolio([btc], [account], [transaction]),
      strategyRepository: fakeStrategy(),
      contributionPlanRepository: fakePlan(),
      marketDataService: fakeMarketData(
        [{ assetId: btc.id, symbol: btc.symbol, price: "100.00", currency: "EUR", timestamp: now, fetchedAt: now, source: "TEST", isStale: true }],
        { hasStalePrices: true, warning: "Cached price in use." },
      ),
    });

    expect(portfolio.valuation).toEqual(expect.objectContaining({
      totalValue: "100.00",
      exactTotalValue: "100.00",
      knownValuedSubtotal: "100.00",
      isPartial: false,
      isCostBasisPartial: true,
      missingCostBasisSymbols: ["BTC"],
      hasStalePrices: true,
      warning: "Cached price in use.",
    }));
    expect(portfolio.risk.isStale).toBe(true);
  });
});

function fakePortfolio(assets: unknown[], accounts: unknown[], transactions: unknown[]) {
  return {
    listAssets: async () => assets,
    listAccounts: async () => accounts,
    listCustodians: async () => [],
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
      allocations: allocations.map((allocation, index) => ({ id: `allocation-${index}`, strategyId: "strategy", ...allocation, assetAllocations: [] })),
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
