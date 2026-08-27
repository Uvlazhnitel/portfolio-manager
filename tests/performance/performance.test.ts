import { AccountType, AssetClass, AssetType, Prisma, TransactionType, type DailyMarketPrice } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MarketDataService } from "@/features/market-data/service";
import { captureDailyMarketPrices } from "@/features/performance/capture";
import { getPerformanceReadModel } from "@/features/performance/read-model";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { HISTORY_RETRY_DELAY_MS, millisecondsUntilNextCapture, runHistoryWorker } from "@/features/performance/worker";
import {
  calculateHistoricalPerformance,
  type EngineAsset,
  type EngineTransaction,
} from "@/features/portfolio-engine";
import type { PortfolioRepository } from "@/features/portfolio/repository";
import type { StrategyRepository } from "@/features/strategy/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

const assets: EngineAsset[] = [
  { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
  { id: "usd", symbol: "USD", name: "US Dollar", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" },
];

const transactions: EngineTransaction[] = [
  cashTransaction("deposit", TransactionType.DEPOSIT, "1000", "2026-08-01T08:00:00Z"),
  cashTransaction("cash-buy-leg", TransactionType.SELL, "1000", "2026-08-01T09:00:00Z"),
  assetTransaction("buy", TransactionType.BUY, "0.1", "2026-08-01T09:00:00Z"),
  assetTransaction("transfer-out", TransactionType.TRANSFER_OUT, "0.1", "2026-08-02T10:00:00Z", "exchange"),
  assetTransaction("transfer-in", TransactionType.TRANSFER_IN, "0.1", "2026-08-02T10:00:00Z", "wallet"),
  assetTransaction("sell", TransactionType.SELL, "0.02", "2026-08-03T09:00:00Z", "wallet"),
  cashTransaction("cash-sell-leg", TransactionType.BUY, "300", "2026-08-03T09:00:00Z"),
  cashTransaction("withdrawal", TransactionType.WITHDRAWAL, "200", "2026-08-03T10:00:00Z"),
];

describe("historical performance engine", () => {
  it("separates contributions from investment gain and ignores transfers", () => {
    const history = calculateHistoricalPerformance({
      assets,
      transactions,
      baseCurrency: "USD",
      snapshots: [
        snapshot("2026-08-01", "10000"),
        snapshot("2026-08-02", "12000"),
        snapshot("2026-08-03", "15000"),
      ],
    });

    expect(history[0]).toEqual(expect.objectContaining({ portfolioValue: "1000.00", netInvested: "1000.00", investmentGain: "0.00", simpleReturnPercent: "0.00" }));
    expect(history[1]).toEqual(expect.objectContaining({ portfolioValue: "1200.00", netInvested: "1000.00", investmentGain: "200.00", simpleReturnPercent: "20.00" }));
    expect(history[2]).toEqual(expect.objectContaining({ portfolioValue: "1300.00", netInvested: "900.00", investmentGain: "400.00", simpleReturnPercent: "44.44" }));
  });

  it("leaves incomplete valuations blank without losing the cashflow series", () => {
    const history = calculateHistoricalPerformance({
      assets,
      transactions: transactions.slice(0, 3),
      baseCurrency: "USD",
      snapshots: [{ date: "2026-08-01", marketPrices: { USD: "1" }, hasStalePrices: true }],
    });

    expect(history[0]).toEqual(expect.objectContaining({
      portfolioValue: null,
      netInvested: "1000.00",
      investmentGain: null,
      simpleReturnPercent: null,
      isComplete: false,
      missingPriceSymbols: ["BTC"],
      hasStalePrices: true,
    }));
  });

  it("recalculates later history when a transaction is backdated", () => {
    const input = { assets, baseCurrency: "USD", snapshots: [snapshot("2026-08-02", "12000")] };
    const before = calculateHistoricalPerformance({ ...input, transactions: transactions.slice(0, 3) });
    const after = calculateHistoricalPerformance({
      ...input,
      transactions: [...transactions.slice(0, 3), assetTransaction("backdated", TransactionType.BUY, "0.01", "2026-08-01T18:00:00Z")],
    });

    expect(before[0].portfolioValue).toBe("1200.00");
    expect(after[0].portfolioValue).toBe("1320.00");
  });

  it("marks missing acquisition prices partial without estimating them from the snapshot", () => {
    const openingTransaction = assetTransaction(
      "opening-balance",
      TransactionType.INITIAL_BALANCE,
      "0.1",
      "2026-08-25T18:00:00Z",
    );
    openingTransaction.pricePerUnit = null;
    const history = calculateHistoricalPerformance({
      assets,
      transactions: [openingTransaction],
      baseCurrency: "USD",
      snapshots: [snapshot("2026-08-26", "12000")],
    });
    expect(history[0]).toEqual(expect.objectContaining({
      portfolioValue: "1200.00",
      netInvested: "0.00",
      investmentGain: "0.00",
      simpleReturnPercent: null,
      isCostBasisPartial: true,
      missingCostBasisSymbols: ["BTC"],
    }));
  });

  it("calculates partial gain only from assets with complete cost basis", () => {
    const eth: EngineAsset = { id: "eth", symbol: "ETH", name: "Ethereum", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "ETH" };
    const history = calculateHistoricalPerformance({
      assets: [...assets, eth],
      transactions: [
        assetTransaction("known-btc", TransactionType.BUY, "0.1", "2026-08-24T10:00:00Z"),
        { id: "unknown-eth", assetId: "eth", accountId: "exchange", type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: null, currency: "USD", executedAt: "2026-08-25T10:00:00Z" },
      ],
      baseCurrency: "USD",
      snapshots: [{ date: "2026-08-26", marketPrices: { BTC: "15000", ETH: "2000", USD: "1" }, hasStalePrices: false }],
    });

    expect(history[0]).toEqual(expect.objectContaining({
      portfolioValue: "3500.00",
      netInvested: "1000.00",
      investmentGain: "500.00",
      simpleReturnPercent: "50.00",
      isCostBasisPartial: true,
      missingCostBasisSymbols: ["ETH"],
    }));
  });

  it("derives opening contributions from buys minus reused sale proceeds", () => {
    const openingTransactions = [
      assetTransaction("first-buy", TransactionType.BUY, "0.1", "2026-08-24T10:00:00Z"),
      assetTransaction("sale", TransactionType.SELL, "0.04", "2026-08-24T11:00:00Z"),
      { ...assetTransaction("reinvest", TransactionType.BUY, "0.03", "2026-08-25T10:00:00Z"), pricePerUnit: "12000" },
    ];
    const history = calculateHistoricalPerformance({
      assets,
      transactions: openingTransactions,
      baseCurrency: "USD",
      snapshots: [snapshot("2026-08-26", "15000")],
    });

    expect(history[0]).toEqual(expect.objectContaining({
      portfolioValue: "1350.00",
      netInvested: "960.00",
      investmentGain: "390.00",
      simpleReturnPercent: "40.63",
    }));
  });

  it("adds buy fees and subtracts sell fees from net proceeds", () => {
    const buy = { ...assetTransaction("buy-with-fee", TransactionType.BUY, "0.1", "2026-08-24T10:00:00Z"), fee: "10" };
    const sell = { ...assetTransaction("sell-with-fee", TransactionType.SELL, "0.04", "2026-08-25T10:00:00Z"), fee: "2" };
    const history = calculateHistoricalPerformance({
      assets,
      transactions: [buy, sell],
      baseCurrency: "USD",
      snapshots: [snapshot("2026-08-26", "15000")],
    });

    expect(history[0]).toEqual(expect.objectContaining({
      portfolioValue: "900.00",
      netInvested: "612.00",
      investmentGain: "288.00",
      simpleReturnPercent: "47.06",
    }));
  });
});

describe("daily price capture", () => {
  it("persists resolved, stale, and unavailable quote metadata", async () => {
    const writes: Parameters<DailyMarketPriceStore["saveDailyPrices"]>[0] = [];
    const now = new Date("2026-08-26T14:30:00Z");
    const result = await captureDailyMarketPrices({
      now,
      portfolioRepository: { listAssets: async () => assets } as unknown as PortfolioRepository,
      strategyRepository: { findActiveStrategy: async () => ({ baseCurrency: "USD" }) } as unknown as StrategyRepository,
      marketDataService: {
        getCurrentPrices: async () => ({
          prices: [{ assetId: "btc", symbol: "BTC", price: "12345", currency: "USD", timestamp: new Date("2026-08-25T14:00:00Z"), fetchedAt: now, source: "CACHE", isStale: true }],
          unavailableAssetIds: ["usd"],
          lastUpdated: null,
          hasStalePrices: true,
          wasRefreshed: false,
          refreshBlockedUntil: null,
          warning: "Provider unavailable.",
        }),
      } as unknown as MarketDataService,
      dailyPriceStore: { saveDailyPrices: async (prices) => { writes.push(...prices); }, listDailyPrices: async () => [] },
    });

    expect(result).toEqual(expect.objectContaining({ date: "2026-08-26", capturedPrices: 1, unavailableAssetIds: ["usd"], hasStalePrices: true }));
    expect(writes[0]).toEqual(expect.objectContaining({ date: new Date("2026-08-26T00:00:00Z"), quoteTimestamp: new Date("2026-08-25T14:00:00Z"), isStaleAtCapture: true }));
  });

  it("preserves a fresh Alpha daily close in history capture", async () => {
    const writes: Parameters<DailyMarketPriceStore["saveDailyPrices"]>[0] = [];
    const now = new Date("2026-08-27T14:30:00Z");
    await captureDailyMarketPrices({
      now,
      portfolioRepository: { listAssets: async () => assets } as unknown as PortfolioRepository,
      strategyRepository: { findActiveStrategy: async () => ({ baseCurrency: "USD" }) } as unknown as StrategyRepository,
      marketDataService: {
        getCurrentPrices: async () => ({
          prices: [{ assetId: "btc", symbol: "BTC", price: "12345", currency: "USD", timestamp: new Date("2026-08-26T23:59:59Z"), fetchedAt: now, source: "ALPHA_VANTAGE", isStale: false }],
          unavailableAssetIds: [],
          lastUpdated: "2026-08-26T23:59:59.000Z",
          hasStalePrices: false,
          wasRefreshed: true,
          refreshBlockedUntil: null,
          warning: null,
        }),
      } as unknown as MarketDataService,
      dailyPriceStore: { saveDailyPrices: async (prices) => { writes.push(...prices); }, listDailyPrices: async () => [] },
    });

    expect(writes[0]).toEqual(expect.objectContaining({
      source: "ALPHA_VANTAGE",
      quoteTimestamp: new Date("2026-08-26T23:59:59Z"),
      isStaleAtCapture: false,
    }));
  });

  it("requests a forced market-data refresh for the 23:55 UTC history capture", async () => {
    const writes: Parameters<DailyMarketPriceStore["saveDailyPrices"]>[0] = [];
    const now = new Date("2026-08-27T23:55:00Z");
    const getCurrentPrices = vi.fn(async () => ({
      prices: [{ assetId: "btc", symbol: "BTC", price: "12345", currency: "USD", timestamp: new Date("2026-08-27T23:59:59Z"), fetchedAt: now, source: "ALPHA_VANTAGE", isStale: false }],
      unavailableAssetIds: [],
      lastUpdated: "2026-08-27T23:59:59.000Z",
      hasStalePrices: false,
      wasRefreshed: true,
      refreshBlockedUntil: null,
      warning: null,
    }));

    await captureDailyMarketPrices({
      now,
      portfolioRepository: { listAssets: async () => assets } as unknown as PortfolioRepository,
      strategyRepository: { findActiveStrategy: async () => ({ baseCurrency: "USD" }) } as unknown as StrategyRepository,
      marketDataService: { getCurrentPrices } as unknown as MarketDataService,
      dailyPriceStore: { saveDailyPrices: async (prices) => { writes.push(...prices); }, listDailyPrices: async () => [] },
    });

    expect(getCurrentPrices).toHaveBeenCalledWith(expect.objectContaining({
      baseCurrency: "USD",
      forceRefresh: true,
      now,
    }));
    expect(writes[0]).toEqual(expect.objectContaining({
      source: "ALPHA_VANTAGE",
      quoteTimestamp: new Date("2026-08-27T23:59:59Z"),
      isStaleAtCapture: false,
    }));
  });
});

describe("history worker", () => {
  it("retries a failed capture and stops after a successful retry", async () => {
    let attempts = 0;
    let stopped = false;
    const waits: number[] = [];
    await runHistoryWorker({
      capture: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary");
        stopped = true;
        return { date: "2026-08-26", capturedPrices: 2, unavailableAssetIds: [], hasStalePrices: false, warning: null };
      },
      wait: async (milliseconds) => { waits.push(milliseconds); },
      shouldStop: () => stopped,
    });

    expect(attempts).toBe(2);
    expect(waits).toEqual([HISTORY_RETRY_DELAY_MS]);
  });

  it("schedules the next fixed UTC capture", () => {
    expect(millisecondsUntilNextCapture(new Date("2026-08-26T23:54:00Z"))).toBe(60_000);
    expect(millisecondsUntilNextCapture(new Date("2026-08-26T23:56:00Z"))).toBe(86_340_000);
  });
});

describe("daily price repository", () => {
  let testDb: TestDatabase;
  let btcId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const btc = await testDb.prisma.asset.create({ data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" } });
    btcId = btc.id;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("upserts repeated captures for the same asset, currency, and UTC day", async () => {
    const repository = new DailyMarketPriceRepository(testDb.prisma);
    const base = { assetId: btcId, currency: "USD", date: new Date("2026-08-26T00:00:00Z"), source: "TEST", quoteTimestamp: new Date("2026-08-26T20:00:00Z"), capturedAt: new Date("2026-08-26T20:01:00Z"), isStaleAtCapture: false };
    await repository.saveDailyPrices([{ ...base, price: "100" }]);
    await repository.saveDailyPrices([{ ...base, price: "110", capturedAt: new Date("2026-08-26T21:01:00Z") }]);

    const rows = await repository.listDailyPrices("USD");
    expect(rows).toHaveLength(1);
    expect(rows[0].price.toString()).toBe("110");
    expect(rows[0].capturedAt).toEqual(new Date("2026-08-26T21:01:00Z"));
  });
});

describe("performance read model", () => {
  it("exposes summary and historical coverage states", async () => {
    const now = new Date("2026-08-26T20:00:00Z");
    const account = { id: "account", name: "Main", type: AccountType.OTHER, description: null, createdAt: now, updatedAt: now };
    const assetRows = assets.map((asset) => ({ ...asset, externalId: null, metadata: null, createdAt: now, updatedAt: now }));
    const transactionRows = transactions.slice(0, 3).map((transaction) => ({ ...transaction, id: transaction.id ?? "transaction", fee: null, note: null, createdAt: now, updatedAt: now, account, asset: assetRows.find((asset) => asset.id === transaction.assetId)! }));
    const dailyRows = [dailyPrice("btc", "10000", now), dailyPrice("usd", "1", now)];
    const model = await getPerformanceReadModel({
      portfolioRepository: { listAssets: async () => assetRows, listTransactions: async () => transactionRows } as unknown as PortfolioRepository,
      strategyRepository: { findActiveStrategy: async () => ({ baseCurrency: "USD" }) } as unknown as StrategyRepository,
      marketDataService: { getCurrentPrices: async () => ({ prices: dailyRows.map((price) => ({ assetId: price.assetId, symbol: assetRows.find((asset) => asset.id === price.assetId)!.symbol, price: price.price.toString(), currency: "USD", timestamp: now, fetchedAt: now, source: "TEST", isStale: false })), unavailableAssetIds: [], lastUpdated: now.toISOString(), hasStalePrices: false, wasRefreshed: false, refreshBlockedUntil: null, warning: null }) } as unknown as MarketDataService,
      dailyPriceStore: { listDailyPrices: async () => dailyRows, saveDailyPrices: vi.fn() },
    });

    expect(model.summary).toEqual(expect.objectContaining({ portfolioValue: "1000.00", netInvested: "1000.00", netContributed: "1000.00", investmentGain: "0.00", simpleReturnPercent: "0.00", isPartial: false }));
    expect(model.history).toHaveLength(1);
    expect(model.trackingStartedAt).toBe("2026-08-26");
  });
});

function snapshot(date: string, btcPrice: string) { return { date, marketPrices: { BTC: btcPrice, USD: "1" }, hasStalePrices: false }; }
function cashTransaction(id: string, type: TransactionType, quantity: string, executedAt: string): EngineTransaction { return { id, assetId: "usd", accountId: "bank", type, quantity, pricePerUnit: "1", currency: "USD", executedAt }; }
function assetTransaction(id: string, type: TransactionType, quantity: string, executedAt: string, accountId = "exchange"): EngineTransaction { return { id, assetId: "btc", accountId, type, quantity, pricePerUnit: type === TransactionType.BUY || type === TransactionType.SELL ? "10000" : null, currency: "USD", executedAt }; }
function dailyPrice(assetId: string, price: string, timestamp: Date): DailyMarketPrice { return { id: `daily-${assetId}`, assetId, currency: "USD", date: new Date("2026-08-26T00:00:00Z"), price: new Prisma.Decimal(price), source: "TEST", quoteTimestamp: timestamp, capturedAt: timestamp, isStaleAtCapture: false, createdAt: timestamp, updatedAt: timestamp }; }
