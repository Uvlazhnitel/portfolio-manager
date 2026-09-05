import { AccountType, AssetClass, AssetType, PortfolioRuleType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getIntelligenceReadModel } from "@/features/intelligence/read-model";
import { MarketDataService } from "@/features/market-data/service";
import type { DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";

describe("intelligence read model", () => {
  it("selects the previous daily baseline and preserves quote source metadata for attribution", async () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const custodian = { id: "custodian", name: "Broker", category: "BROKER" as const, description: null, createdAt: now, updatedAt: now };
    const account = { id: "broker", name: "Broker", type: AccountType.BROKER, description: null, custodianId: custodian.id, custodian, createdAt: now, updatedAt: now };
    const asset = {
      id: "etf", symbol: "ETF", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF,
      currency: "USD", externalId: null, quoteProvider: null, quoteSymbol: null, quoteMicCode: null,
      metadata: null, createdAt: now, updatedAt: now,
    };
    const bitcoin = {
      ...asset,
      id: "btc",
      symbol: "BTC",
      name: "Bitcoin",
      assetClass: AssetClass.CRYPTO,
      assetType: AssetType.CRYPTO,
      currency: "BTC",
    };
    const transaction = {
      id: "buy", assetId: asset.id, accountId: account.id, type: TransactionType.BUY,
      quantity: new Prisma.Decimal(9), pricePerUnit: new Prisma.Decimal(10), fee: null, currency: "USD",
      executedAt: new Date("2026-08-27T12:00:00Z"), note: null, transactionGroupId: null,
      createdAt: now, updatedAt: now, asset, account, transactionGroup: null,
    };
    const bitcoinTransaction = {
      ...transaction,
      id: "buy-btc",
      assetId: bitcoin.id,
      quantity: new Prisma.Decimal(1),
      asset: bitcoin,
    };
    const model = await getIntelligenceReadModel({
      portfolioRepository: {
        listAssets: async () => [asset, bitcoin],
        listAccounts: async () => [account],
        listTransactions: async () => [transaction, bitcoinTransaction],
      } as unknown as PortfolioRepository,
      strategyRepository: {
        findActiveStrategy: async () => ({
          id: "strategy", name: "Strategy", objective: "Growth", baseCurrency: "USD", benchmarkAssetId: null,
          createdAt: now, updatedAt: now, benchmarkAsset: null,
          allocations: [
            { id: "allocation-etf", strategyId: "strategy", assetClass: AssetClass.ETF, targetPercent: new Prisma.Decimal(90), minPercent: new Prisma.Decimal(80), maxPercent: new Prisma.Decimal(95), assetAllocations: [] },
            { id: "allocation-btc", strategyId: "strategy", assetClass: AssetClass.CRYPTO, targetPercent: new Prisma.Decimal(10), minPercent: new Prisma.Decimal(5), maxPercent: new Prisma.Decimal(15), assetAllocations: [] },
          ],
          portfolioRules: [
            { id: "drift", strategyId: "strategy", type: PortfolioRuleType.MIN_REBALANCE_DRIFT, enabled: true, config: { minDriftPercent: "2" }, createdAt: now, updatedAt: now },
          ],
        }),
      } as unknown as StrategyRepository,
      marketDataService: {
        getCurrentPrices: async () => ({
          prices: [
            { assetId: asset.id, symbol: asset.symbol, price: "10", currency: "USD", timestamp: now, fetchedAt: now, source: "TEST", isStale: false },
            { assetId: bitcoin.id, symbol: bitcoin.symbol, price: "20", currency: "USD", timestamp: new Date("2026-08-29T11:55:00Z"), fetchedAt: now, source: "COINGECKO", isStale: false },
          ],
          unavailableAssetIds: [], lastUpdated: now.toISOString(), hasStalePrices: false, wasRefreshed: false, refreshBlockedUntil: null, warning: null,
        }),
      } as unknown as MarketDataService,
      dailyPriceStore: {
        listDailyPrices: async () => [
          {
            id: "daily-etf", assetId: asset.id, currency: "USD", date: new Date("2026-08-28T00:00:00Z"),
            price: new Prisma.Decimal(10), source: "TEST", quoteTimestamp: new Date("2026-08-28T20:00:00Z"),
            capturedAt: new Date("2026-08-28T20:00:00Z"), isStaleAtCapture: false, createdAt: now, updatedAt: now,
          },
          {
            id: "daily-btc", assetId: bitcoin.id, currency: "USD", date: new Date("2026-08-28T00:00:00Z"),
            price: new Prisma.Decimal(10), source: "MANUAL", quoteTimestamp: new Date("2026-08-28T19:55:00Z"),
            capturedAt: new Date("2026-08-28T20:00:00Z"), isStaleAtCapture: false, createdAt: now, updatedAt: now,
          },
        ],
        saveDailyPrices: async () => undefined,
      } as DailyMarketPriceStore,
      now,
    });

    expect(model.review).toEqual(expect.objectContaining({
      state: "NEEDS_REVIEW",
      period: expect.objectContaining({
        kind: "PREVIOUS_DAILY_OBSERVATION",
        previousAsOf: "2026-08-28T23:59:59.999Z",
      }),
      dataQuality: expect.objectContaining({ state: "COMPLETE" }),
    }));
    const cryptoSignal = model.review.signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX");
    expect(cryptoSignal).toEqual(expect.objectContaining({
      state: "NEEDS_REVIEW",
      lifecycle: "NEW",
      value: expect.objectContaining({ previous: "10.00", current: "18.18" }),
      primaryCause: expect.objectContaining({ type: "DATA_PRICE_UPDATE", subject: "BTC" }),
    }));
  });
});
