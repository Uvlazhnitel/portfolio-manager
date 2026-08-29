import { AccountType, AssetClass, AssetType, PortfolioRuleType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getIntelligenceReadModel } from "@/features/intelligence/read-model";
import { MarketDataService } from "@/features/market-data/service";
import type { DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";

describe("intelligence read model", () => {
  it("builds the Daily Brief from current and recorded daily portfolio data", async () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const account = { id: "broker", name: "Broker", type: AccountType.BROKER, description: null, createdAt: now, updatedAt: now };
    const asset = {
      id: "etf", symbol: "ETF", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF,
      currency: "USD", externalId: null, quoteProvider: null, quoteSymbol: null, quoteMicCode: null,
      metadata: null, createdAt: now, updatedAt: now,
    };
    const transaction = {
      id: "buy", assetId: asset.id, accountId: account.id, type: TransactionType.BUY,
      quantity: new Prisma.Decimal(10), pricePerUnit: new Prisma.Decimal(10), fee: null, currency: "USD",
      executedAt: new Date("2026-08-27T12:00:00Z"), note: null, transactionGroupId: null,
      createdAt: now, updatedAt: now, asset, account, transactionGroup: null,
    };
    const model = await getIntelligenceReadModel({
      portfolioRepository: {
        listAssets: async () => [asset],
        listAccounts: async () => [account],
        listTransactions: async () => [transaction],
      } as unknown as PortfolioRepository,
      strategyRepository: {
        findActiveStrategy: async () => ({
          id: "strategy", name: "Strategy", objective: "Growth", baseCurrency: "USD", benchmarkAssetId: null,
          createdAt: now, updatedAt: now, benchmarkAsset: null,
          allocations: [{ id: "allocation", strategyId: "strategy", assetClass: AssetClass.ETF, targetPercent: new Prisma.Decimal(100), minPercent: new Prisma.Decimal(90), maxPercent: new Prisma.Decimal(100), assetAllocations: [] }],
          portfolioRules: [
            { id: "drift", strategyId: "strategy", type: PortfolioRuleType.MIN_REBALANCE_DRIFT, enabled: true, config: { minDriftPercent: "2" }, createdAt: now, updatedAt: now },
          ],
        }),
      } as unknown as StrategyRepository,
      marketDataService: {
        getCurrentPrices: async () => ({
          prices: [{ assetId: asset.id, symbol: asset.symbol, price: "11", currency: "USD", timestamp: now, fetchedAt: now, source: "TEST", isStale: false }],
          unavailableAssetIds: [], lastUpdated: now.toISOString(), hasStalePrices: false, wasRefreshed: false, refreshBlockedUntil: null, warning: null,
        }),
      } as unknown as MarketDataService,
      dailyPriceStore: {
        listDailyPrices: async () => [{
          id: "daily", assetId: asset.id, currency: "USD", date: new Date("2026-08-28T00:00:00Z"),
          price: new Prisma.Decimal(10), source: "TEST", quoteTimestamp: new Date("2026-08-28T20:00:00Z"),
          capturedAt: new Date("2026-08-28T20:00:00Z"), isStaleAtCapture: false, createdAt: now, updatedAt: now,
        }],
        saveDailyPrices: async () => undefined,
      } as DailyMarketPriceStore,
      now,
    });

    expect(model.brief).toEqual(expect.objectContaining({
      status: "NO_ACTION",
      previousDate: "2026-08-28",
      dailyGain: "10.00",
      dailyReturnPercent: "10.00",
    }));
    expect(model.brief.positiveContributors[0]).toEqual(expect.objectContaining({ symbol: "ETF", contribution: "10.00" }));
    expect(model.brief.risk.largestAsset.subjectName).toBe("ETF");
    expect(model.brief.risk.largestCustodian.state).toBe("PARTIAL");
  });
});
