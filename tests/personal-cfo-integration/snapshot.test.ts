import { AccountType, AssetClass, AssetType, BasisMethod, Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { MarketDataSnapshot, ResolvedMarketPrice } from "@/features/market-data/types";
import { personalCfoIdentity } from "@/features/personal-cfo-integration/contract";
import { buildPersonalCfoSnapshot } from "@/features/personal-cfo-integration/snapshot";
import type { PortfolioRepository } from "@/features/portfolio/repository";
import type { StrategyRepository } from "@/features/strategy/repository";

const now = new Date("2026-09-23T12:00:00.000Z");
const accountA = account("account-a");
const accountB = account("account-b");
const usd = asset("usd", "USD", AssetClass.CASH, AssetType.FIAT, "USD");
const btc = asset("btc", "BTC", AssetClass.CRYPTO, AssetType.CRYPTO, "BTC");
const gold = asset("gold", "GOLD", AssetClass.GOLD, AssetType.PHYSICAL_GOLD, "XAU");

describe("Personal CFO snapshot contract", () => {
  it("preserves exact values, stable identities, held-component freshness, and cash inclusion", async () => {
    const btcQuantity = "0.001780000000000000";
    const btcPrice = "85210.01652247";
    const snapshot = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository(
        [gold, btc, usd],
        [accountB, accountA],
        [
          transaction("cash", usd, accountB, "25.125", TransactionType.DEPOSIT),
          transaction("btc", btc, accountA, btcQuantity, TransactionType.INITIAL_BALANCE),
        ],
      ),
      strategyRepository: strategyRepository("USD"),
      marketDataService: marketDataService([
        price(usd, "1", now, "BASE_CURRENCY", false),
        price(btc, btcPrice, new Date("2026-09-23T10:00:00.000Z"), "COINGECKO", false),
        price(gold, "3000", new Date("2026-09-20T10:00:00.000Z"), "UNUSED", true),
      ]),
      now,
    });

    const exactBtcValue = new Prisma.Decimal(btcQuantity).mul(btcPrice).toString();
    expect(snapshot.valuation).toEqual({
      status: "complete",
      totalValue: new Prisma.Decimal(exactBtcValue).plus("25.125").toString(),
      knownValuedSubtotal: new Prisma.Decimal(exactBtcValue).plus("25.125").toString(),
      missingPriceSymbols: [],
      hasStalePrices: false,
      sourceAsOf: "2026-09-23T10:00:00.000Z",
      sourceAsOfSemantics: "oldest_component_quote",
    });
    expect(snapshot.cash).toEqual({
      treatment: "included_in_total",
      amount: "25.125",
      currency: "USD",
    });
    expect(snapshot.holdings.items.map((holding) => holding.providerHoldingId)).toEqual([
      "account-a:btc",
      "account-b:usd",
    ]);
    expect(snapshot.holdings.items[0]).toEqual(expect.objectContaining({
      quantity: "0.00178",
      price: btcPrice,
      currentMarketValue: exactBtcValue,
      priceTimestamp: "2026-09-23T10:00:00.000Z",
    }));
    expect(snapshot.holdings.items[0].currentMarketValue).not.toBe(new Prisma.Decimal(exactBtcValue).toFixed(2));
    expect(snapshot.holdings.items[1]).toEqual(expect.objectContaining({
      priceSource: "BASE_CURRENCY",
      priceTimestamp: null,
    }));
  });

  it("never promotes a known subtotal to total value when one or all held prices are missing", async () => {
    const partial = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository(
        [btc, gold],
        [accountA],
        [
          transaction("btc", btc, accountA, "1", TransactionType.INITIAL_BALANCE),
          transaction("gold", gold, accountA, "2", TransactionType.INITIAL_BALANCE),
        ],
      ),
      strategyRepository: strategyRepository("EUR"),
      marketDataService: marketDataService([
        price(btc, "50000.12345678", new Date("2026-09-22T08:00:00.000Z"), "COINGECKO", true, "EUR"),
      ]),
      now,
    });
    expect(partial.valuation).toEqual(expect.objectContaining({
      status: "partial",
      totalValue: null,
      knownValuedSubtotal: "50000.12345678",
      missingPriceSymbols: ["GOLD"],
      hasStalePrices: true,
    }));
    expect(partial.holdings.completeness).toBe("partial");
    expect(partial.holdings.items.find((holding) => holding.symbol === "GOLD")).toEqual(expect.objectContaining({
      price: null,
      currentMarketValue: null,
    }));

    const unavailablePrices = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository(
        [gold],
        [accountA],
        [transaction("gold", gold, accountA, "2", TransactionType.INITIAL_BALANCE)],
      ),
      strategyRepository: strategyRepository("EUR"),
      marketDataService: marketDataService([]),
      now,
    });
    expect(unavailablePrices.valuation).toEqual(expect.objectContaining({
      status: "partial",
      totalValue: null,
      knownValuedSubtotal: "0",
      missingPriceSymbols: ["GOLD"],
      sourceAsOf: null,
    }));
  });

  it("returns null cash amount when any held cash component is unpriced and exact zero for no cash", async () => {
    const missingCash = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository(
        [usd, btc],
        [accountA],
        [
          transaction("cash", usd, accountA, "10", TransactionType.DEPOSIT),
          transaction("btc", btc, accountA, "1", TransactionType.INITIAL_BALANCE),
        ],
      ),
      strategyRepository: strategyRepository("EUR"),
      marketDataService: marketDataService([
        price(btc, "100", now, "TEST", false, "EUR"),
      ]),
      now,
    });
    expect(missingCash.cash).toEqual({ treatment: "included_in_total", amount: null, currency: "EUR" });

    const noCash = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository(
        [btc],
        [accountA],
        [transaction("btc", btc, accountA, "1", TransactionType.INITIAL_BALANCE)],
      ),
      strategyRepository: strategyRepository("USD"),
      marketDataService: marketDataService([price(btc, "100", now, "TEST", false)]),
      now,
    });
    expect(noCash.cash).toEqual({ treatment: "included_in_total", amount: "0", currency: "USD" });
  });

  it("treats an empty portfolio as a complete exact zero", async () => {
    const snapshot = await buildPersonalCfoSnapshot({
      identity: personalCfoIdentity("household"),
      repository: portfolioRepository([], [], []),
      strategyRepository: strategyRepository("USD"),
      marketDataService: marketDataService([]),
      now,
    });
    expect(snapshot.valuation).toEqual(expect.objectContaining({
      status: "complete",
      totalValue: "0",
      knownValuedSubtotal: "0",
    }));
    expect(snapshot.holdings).toEqual({ completeness: "complete", items: [] });
  });
});

function asset(id: string, symbol: string, assetClass: AssetClass, assetType: AssetType, currency: string) {
  return {
    id,
    symbol,
    name: `${symbol} asset`,
    assetClass,
    assetType,
    currency,
    externalId: null,
    quoteProvider: null,
    quoteSymbol: null,
    quoteMicCode: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

function account(id: string) {
  return {
    id,
    name: id,
    type: AccountType.OTHER,
    description: null,
    custodianId: null,
    createdAt: now,
    updatedAt: now,
    custodian: null,
  };
}

function transaction(id: string, transactionAsset: ReturnType<typeof asset>, transactionAccount: ReturnType<typeof account>, quantity: string, type: TransactionType) {
  return {
    id,
    assetId: transactionAsset.id,
    accountId: transactionAccount.id,
    type,
    basisMethod: type === TransactionType.INITIAL_BALANCE ? BasisMethod.UNKNOWN : null,
    quantity: new Prisma.Decimal(quantity),
    pricePerUnit: type === TransactionType.DEPOSIT ? new Prisma.Decimal(1) : null,
    fee: null,
    currency: transactionAsset.currency,
    fxRateToBase: null,
    fxRateSource: null,
    fxRateDate: null,
    executedAt: now,
    note: "must not be exported",
    transactionGroupId: null,
    status: TransactionStatus.ACTIVE,
    statusChangedAt: null,
    statusReason: null,
    replacesTransactionId: null,
    createdAt: now,
    updatedAt: now,
    asset: transactionAsset,
    account: transactionAccount,
    transactionGroup: null,
  };
}

function price(
  priceAsset: ReturnType<typeof asset>,
  value: string,
  timestamp: Date,
  source: string,
  isStale: boolean,
  currency = "USD",
): ResolvedMarketPrice {
  return {
    assetId: priceAsset.id,
    symbol: priceAsset.symbol,
    price: value,
    currency,
    timestamp,
    fetchedAt: timestamp,
    source,
    isStale,
  };
}

function portfolioRepository(
  assets: ReturnType<typeof asset>[],
  accounts: ReturnType<typeof account>[],
  transactions: ReturnType<typeof transaction>[],
) {
  return {
    listAssets: async () => assets,
    listAccounts: async () => accounts,
    listTransactions: async () => transactions,
  } as unknown as PortfolioRepository;
}

function strategyRepository(baseCurrency: string) {
  return {
    findActiveStrategy: async () => ({ baseCurrency }),
  } as unknown as StrategyRepository;
}

function marketDataService(prices: ResolvedMarketPrice[]) {
  const snapshot: MarketDataSnapshot = {
    prices,
    unavailableAssetIds: [],
    lastUpdated: null,
    hasStalePrices: prices.some((item) => item.isStale),
    wasRefreshed: false,
    refreshBlockedUntil: null,
    warning: null,
  };
  return { getCurrentPrices: async () => snapshot };
}
