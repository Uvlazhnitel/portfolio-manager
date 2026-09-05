import { AssetClass, AssetType, TransactionGroupKind, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculatePortfolioReview,
  type CalculatePortfolioReviewInput,
  type EngineAsset,
  type EngineStrategyAllocation,
  type EngineTransaction,
  type PortfolioPriceObservation,
} from "@/features/portfolio-engine";

const etf: EngineAsset = { id: "etf", symbol: "ETF", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" };
const crypto: EngineAsset = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" };
const eur: EngineAsset = { id: "eur", symbol: "EUR", name: "Euro", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" };

describe("portfolio review signals", () => {
  it("classifies NEW, WORSENED, IMPROVED, ONGOING, and RESOLVED strategy signals", () => {
    expect(strategySignal("10", "20")).toEqual(expect.objectContaining({ lifecycle: "NEW", state: "NEEDS_REVIEW" }));
    expect(strategySignal("20", "30")).toEqual(expect.objectContaining({ lifecycle: "WORSENED", state: "NEEDS_REVIEW" }));
    expect(strategySignal("30", "20")).toEqual(expect.objectContaining({ lifecycle: "IMPROVED", state: "WATCH" }));
    expect(strategySignal("20", "20.1")).toEqual(expect.objectContaining({ lifecycle: "ONGOING", state: "WATCH" }));
    expect(strategySignal("20", "10")).toEqual(expect.objectContaining({ lifecycle: "RESOLVED", state: "CLEAR" }));
  });

  it("keeps strategy and risk materiality independent", () => {
    const strategyBelowMateriality = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "8.4"), buy("btc", "1.6")],
      previousPrices: { ETF: "10", BTC: "9.6" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: [
        { assetClass: AssetClass.ETF, targetPercent: "85", minPercent: "80", maxPercent: "90" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "15.5" },
      ],
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX");
    expect(strategyBelowMateriality).toEqual(expect.objectContaining({ lifecycle: "NEW", state: "WATCH" }));

    const riskCrossing = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "6"), buy("btc", "4")],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10.1", BTC: "10" },
      strategy: null,
      rules: { challengeStrategyViolations: false, strategyMaterialityPercent: "99" },
      riskThresholds: { singleAssetMaxPercent: "60", custodianMaxPercent: null },
    })).signals.find((signal) => signal.category === "RISK");
    expect(riskCrossing).toEqual(expect.objectContaining({ lifecycle: "NEW", state: "NEEDS_REVIEW" }));
  });

  it("uses the one-point risk threshold only for worsening an existing breach", () => {
    const ongoing = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "6"), buy("btc", "4")],
      previousPrices: { ETF: "10.1", BTC: "10" },
      currentPrices: { ETF: "10.2", BTC: "10" },
      strategy: null,
      riskThresholds: { singleAssetMaxPercent: "60", custodianMaxPercent: null },
    })).signals.find((signal) => signal.category === "RISK");
    expect(ongoing).toEqual(expect.objectContaining({ lifecycle: "ONGOING", state: "WATCH" }));

    const worsened = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "6"), buy("btc", "4")],
      previousPrices: { ETF: "10.1", BTC: "10" },
      currentPrices: { ETF: "11", BTC: "10" },
      strategy: null,
      riskThresholds: { singleAssetMaxPercent: "60", custodianMaxPercent: null },
    })).signals.find((signal) => signal.category === "RISK");
    expect(worsened).toEqual(expect.objectContaining({ lifecycle: "WORSENED", state: "NEEDS_REVIEW" }));
  });

  it("attributes allocation changes to market, FX, BUY, TRADE, and data updates", () => {
    expect(strategySignal("10", "20").primaryCause.type).toBe("MARKET_PRICE_MOVEMENT");

    const bought = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1"), { ...buy("btc", "1"), id: "today-buy", executedAt: "2026-08-29T08:00:00Z" }],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: twoClassStrategy(),
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
    expect(bought.primaryCause.type).toBe("BUY");

    const traded = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1"),
        {
          ...buy("etf", "4"), id: "trade-out", type: TransactionType.SELL, executedAt: "2026-08-29T08:00:00Z",
          transactionGroupId: "trade", transactionGroup: { kind: TransactionGroupKind.TRADE },
        },
        {
          ...buy("btc", "4"), id: "trade-in", executedAt: "2026-08-29T08:00:00Z",
          transactionGroupId: "trade", transactionGroup: { kind: TransactionGroupKind.TRADE },
        },
      ],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: twoClassStrategy(),
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
    expect(traded.primaryCause.type).toBe("TRADE");

    const fx = review(makeInput({
      assets: [etf, eur],
      transactions: [buy("etf", "9"), buy("eur", "10")],
      previousPrices: { ETF: "10", EUR: "1" },
      currentPrices: { ETF: "10", EUR: "2" },
      strategy: [
        { assetClass: AssetClass.ETF, targetPercent: "90", minPercent: "80", maxPercent: "95" },
        { assetClass: AssetClass.CASH, targetPercent: "10", minPercent: "5", maxPercent: "15" },
      ],
    })).signals.find((signal) => signal.id === "STRATEGY:CASH_ABOVE_MAX")!;
    expect(fx.primaryCause.type).toBe("FX_MOVEMENT");

    const dataUpdate = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1")],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "20" },
      previousSources: { BTC: "MANUAL" },
      currentSources: { BTC: "COINGECKO" },
      strategy: twoClassStrategy(),
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
    expect(dataUpdate.primaryCause.type).toBe("DATA_PRICE_UPDATE");
  });

  it("distinguishes SELL, contribution, and withdrawal ledger causes", () => {
    const sold = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1"), {
        id: "today-sell", assetId: "etf", accountId: "account", type: TransactionType.SELL,
        quantity: "4", pricePerUnit: "10", currency: "USD", executedAt: "2026-08-29T08:00:00Z",
      }],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: twoClassStrategy(),
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
    expect(sold.primaryCause.type).toBe("SELL");

    const contributed = review(makeInput({
      assets: [etf, eur],
      transactions: [buy("etf", "9"), buy("eur", "10"), {
        id: "today-deposit", assetId: "eur", accountId: "account", type: TransactionType.DEPOSIT,
        quantity: "10", currency: "EUR", executedAt: "2026-08-29T08:00:00Z",
      }],
      previousPrices: { ETF: "10", EUR: "1" },
      currentPrices: { ETF: "10", EUR: "1" },
      strategy: [
        { assetClass: AssetClass.ETF, targetPercent: "90", minPercent: "80", maxPercent: "95" },
        { assetClass: AssetClass.CASH, targetPercent: "10", minPercent: "5", maxPercent: "15" },
      ],
    })).signals.find((signal) => signal.id === "STRATEGY:CASH_ABOVE_MAX")!;
    expect(contributed.primaryCause.type).toBe("CONTRIBUTION");

    const withdrawn = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1"), {
        id: "today-withdrawal", assetId: "etf", accountId: "account", type: TransactionType.WITHDRAWAL,
        quantity: "4", currency: "USD", executedAt: "2026-08-29T08:00:00Z",
      }],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: twoClassStrategy(),
    })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
    expect(withdrawn.primaryCause.type).toBe("WITHDRAWAL");
  });

  it("attributes a new custodian breach to a transfer", () => {
    const accounts = [
      { id: "a", name: "A", type: "BROKER", custodian: { id: "cust-a", name: "Custodian A", category: "BROKER" as const } },
      { id: "b", name: "B", type: "BROKER", custodian: { id: "cust-b", name: "Custodian B", category: "BROKER" as const } },
    ];
    const transferGroup = { kind: TransactionGroupKind.TRANSFER };
    const result = review(makeInput({
      assets: [etf],
      accounts,
      transactions: [buy("etf", "5", "a"), buy("etf", "5", "b"), {
        id: "out", assetId: "etf", accountId: "b", type: TransactionType.TRANSFER_OUT, quantity: "2", executedAt: "2026-08-29T08:00:00Z", transactionGroupId: "transfer", transactionGroup: transferGroup,
      }, {
        id: "in", assetId: "etf", accountId: "a", type: TransactionType.TRANSFER_IN, quantity: "2", executedAt: "2026-08-29T08:00:00Z", transactionGroupId: "transfer", transactionGroup: transferGroup,
      }],
      previousPrices: { ETF: "10" },
      currentPrices: { ETF: "10" },
      strategy: null,
      riskThresholds: { singleAssetMaxPercent: null, custodianMaxPercent: "60" },
    }));
    const signal = result.signals.find((candidate) => candidate.id.includes("CUSTODIAN_LIMIT_EXCEEDED"));
    expect(signal).toEqual(expect.objectContaining({ lifecycle: "NEW", state: "NEEDS_REVIEW" }));
    expect(signal?.primaryCause.type).toBe("TRANSFER");
  });

  it("preserves partial and stale semantics without exact policy conclusions", () => {
    const previousPartial = review(makeInput({ previousPrices: {}, currentPrices: { ETF: "10" } }));
    expect(previousPartial.state).toBe("WATCH");
    expect(previousPartial.dataQuality.reasons).toContain("PREVIOUS_VALUATION_INCOMPLETE");
    expect(previousPartial.signals.some((signal) => signal.category === "STRATEGY")).toBe(false);
    expect(previousPartial.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "DATA_QUALITY", lifecycle: "RESOLVED" }),
    ]));

    const currentPartial = review(makeInput({ previousPrices: { ETF: "10" }, currentPrices: {} }));
    expect(currentPartial.state).toBe("NEEDS_REVIEW");
    expect(currentPartial.dataQuality.reasons).toContain("CURRENT_VALUATION_INCOMPLETE");
    expect(currentPartial.signals.some((signal) => signal.category === "STRATEGY")).toBe(false);

    const stale = review(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9"), buy("btc", "1")],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "20" },
      strategy: twoClassStrategy(),
      currentStale: true,
    }));
    expect(stale.state).toBe("WATCH");
    expect(stale.dataQuality.state).toBe("STALE");
    expect(stale.signals.some((signal) => signal.category === "STRATEGY" || signal.category === "RISK")).toBe(false);
  });

  it("returns CLEAR when no material policy or data-quality change exists", () => {
    const result = review(makeInput());
    expect(result.state).toBe("CLEAR");
    expect(result.summary).toBe("Portfolio is clear.");
    expect(result.signals).toEqual([]);
  });
});

function strategySignal(previousBtcPrice: string, currentBtcPrice: string) {
  return review(makeInput({
    assets: [etf, crypto],
    transactions: [buy("etf", "9"), buy("btc", "1")],
    previousPrices: { ETF: "10", BTC: previousBtcPrice },
    currentPrices: { ETF: "10", BTC: currentBtcPrice },
    strategy: twoClassStrategy(),
  })).signals.find((signal) => signal.id === "STRATEGY:CRYPTO_ABOVE_MAX")!;
}

function review(input: CalculatePortfolioReviewInput) {
  return calculatePortfolioReview(input);
}

function makeInput(overrides: {
  assets?: EngineAsset[];
  accounts?: CalculatePortfolioReviewInput["accounts"];
  transactions?: EngineTransaction[];
  previousPrices?: Record<string, string>;
  currentPrices?: Record<string, string>;
  previousSources?: Record<string, string>;
  currentSources?: Record<string, string>;
  strategy?: EngineStrategyAllocation[] | null;
  currentStale?: boolean;
  previousStale?: boolean;
  riskThresholds?: CalculatePortfolioReviewInput["riskThresholds"];
  rules?: Partial<CalculatePortfolioReviewInput["rules"]>;
} = {}): CalculatePortfolioReviewInput {
  const assets = overrides.assets ?? [etf];
  const previousPrices = overrides.previousPrices ?? { ETF: "10" };
  const currentPrices = overrides.currentPrices ?? { ETF: "10" };
  return {
    assets,
    accounts: overrides.accounts ?? [{ id: "account", name: "Broker", type: "BROKER", custodian: { id: "custodian", name: "Broker", category: "BROKER" } }],
    transactions: overrides.transactions ?? [buy("etf", "10")],
    baseCurrency: "USD",
    currentMarketPrices: currentPrices,
    currentPriceObservations: observations(assets, currentPrices, overrides.currentSources, overrides.currentStale ?? false, "2026-08-29T12:00:00Z"),
    currentHasStalePrices: overrides.currentStale ?? false,
    marketDataWarning: null,
    baseline: {
      kind: "PREVIOUS_DAILY_OBSERVATION",
      asOf: "2026-08-28T23:59:59.999Z",
      marketPrices: previousPrices,
      priceObservations: observations(assets, previousPrices, overrides.previousSources, overrides.previousStale ?? false, "2026-08-28T20:00:00Z"),
      hasStalePrices: overrides.previousStale ?? false,
    },
    strategy: overrides.strategy === undefined ? [{ assetClass: AssetClass.ETF, targetPercent: "100", minPercent: "90", maxPercent: "100" }] : overrides.strategy,
    rules: {
      preferContributionsOverSelling: true,
      challengeStrategyViolations: true,
      strategyMaterialityPercent: "2",
      riskMaterialityPercent: "1",
      ...overrides.rules,
    },
    riskThresholds: overrides.riskThresholds ?? { singleAssetMaxPercent: null, custodianMaxPercent: null },
    asOf: "2026-08-29T12:00:00Z",
  };
}

function observations(assets: EngineAsset[], prices: Record<string, string>, sources: Record<string, string> | undefined, stale: boolean, timestamp: string): PortfolioPriceObservation[] {
  return assets.flatMap((asset) => prices[asset.symbol] === undefined ? [] : [{
    assetId: asset.id,
    symbol: asset.symbol,
    price: prices[asset.symbol],
    source: sources?.[asset.symbol] ?? "TEST",
    quoteTimestamp: timestamp,
    capturedAt: timestamp,
    isStale: stale,
  }]);
}

function buy(assetId: string, quantity: string, accountId = "account"): EngineTransaction {
  return { id: `buy-${assetId}-${quantity}-${accountId}`, assetId, accountId, type: TransactionType.BUY, quantity, pricePerUnit: "10", currency: "USD", executedAt: "2026-08-27T12:00:00Z" };
}

function twoClassStrategy(): EngineStrategyAllocation[] {
  return [
    { assetClass: AssetClass.ETF, targetPercent: "90", minPercent: "80", maxPercent: "95" },
    { assetClass: AssetClass.CRYPTO, targetPercent: "10", minPercent: "5", maxPercent: "15" },
  ];
}
