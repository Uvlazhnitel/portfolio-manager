import { AssetClass, AssetType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateDailyBrief,
  type CalculateDailyBriefInput,
  type EngineAsset,
  type EngineStrategyAllocation,
  type EngineTransaction,
} from "@/features/portfolio-engine";

const etf: EngineAsset = { id: "etf", symbol: "ETF", name: "ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" };
const crypto: EngineAsset = { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "USD" };
const gold: EngineAsset = { id: "gold", symbol: "GOLD", name: "Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "USD" };
const usd: EngineAsset = { id: "usd", symbol: "USD", name: "US Dollar", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" };

describe("daily brief engine", () => {
  it("calculates normal daily gain and return", () => {
    const result = calculateDailyBrief(makeInput({ currentPrices: { ETF: "11" } }));

    expect(result.previousValue).toBe("100.00");
    expect(result.currentValue).toBe("110.00");
    expect(result.portfolioValueChange).toBe("10.00");
    expect(result.dailyGain).toBe("10.00");
    expect(result.dailyReturnPercent).toBe("10.00");
  });

  it("removes an external contribution from daily performance", () => {
    const result = calculateDailyBrief(makeInput({
      assets: [etf, usd],
      currentPrices: { ETF: "10", USD: "1" },
      previousPrices: { ETF: "10", USD: "1" },
      transactions: [buy("etf", "10", "10"), {
        id: "deposit",
        assetId: "usd",
        accountId: "account",
        type: TransactionType.DEPOSIT,
        quantity: "50",
        currency: "USD",
        executedAt: "2026-08-29T08:00:00Z",
      }],
    }));

    expect(result.portfolioValueChange).toBe("50.00");
    expect(result.externalContributions).toBe("50.00");
    expect(result.dailyGain).toBe("0.00");
    expect(result.dailyReturnPercent).toBe("0.00");
  });

  it("returns ACTION for a new violation crossing the minimum drift", () => {
    const result = calculateDailyBrief(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9", "10"), buy("btc", "1", "10")],
      previousPrices: { ETF: "10", BTC: "10" },
      currentPrices: { ETF: "10", BTC: "20" },
      strategy: twoClassStrategy(),
    }));

    expect(result.status).toBe("ACTION");
    expect(result.newViolations.map((warning) => warning.code)).toContain("CRYPTO_ABOVE_MAX");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "NEW_STRATEGY_VIOLATION",
      "MINIMUM_REBALANCE_DRIFT_EXCEEDED",
      "CONTRIBUTION_FIRST_REVIEW",
    ]));
    expect(result.summary.toLowerCase()).not.toContain("sell");
  });

  it("reports a violation that disappeared since the previous observation", () => {
    const result = calculateDailyBrief(makeInput({
      assets: [etf, crypto],
      transactions: [buy("etf", "9", "10"), buy("btc", "1", "10")],
      previousPrices: { ETF: "10", BTC: "20" },
      currentPrices: { ETF: "10", BTC: "10" },
      strategy: twoClassStrategy(),
    }));

    expect(result.status).toBe("NO_ACTION");
    expect(result.resolvedViolations.map((warning) => warning.code)).toContain("CRYPTO_ABOVE_MAX");
    expect(result.reasonCodes).toContain("STRATEGY_VIOLATION_RESOLVED");
  });

  it("prefers NO ACTION when there is no meaningful strategy or risk change", () => {
    const result = calculateDailyBrief(makeInput({ currentPrices: { ETF: "10.01" } }));

    expect(result.status).toBe("NO_ACTION");
    expect(result.reasonCodes).toEqual(["NO_MEANINGFUL_STRATEGY_CHANGE"]);
  });

  it("does not estimate incomplete history and marks stale history for monitoring", () => {
    const incomplete = calculateDailyBrief(makeInput({ previousPrices: {} }));
    const stale = calculateDailyBrief(makeInput({ previousStale: true }));

    expect(incomplete.unavailableReason).toBe("PREVIOUS_VALUATION_INCOMPLETE");
    expect(incomplete.dailyGain).toBeNull();
    expect(incomplete.status).toBe("NO_ACTION");
    expect(incomplete.reasonCodes).toContain("INSUFFICIENT_DAILY_DATA");
    expect(stale.status).toBe("MONITOR");
    expect(stale.reasonCodes).toContain("STALE_PRICE_DATA");
  });

  it("ranks positive and negative contributors by monetary impact", () => {
    const result = calculateDailyBrief(makeInput({
      assets: [etf, crypto, gold],
      transactions: [buy("etf", "10", "10"), buy("btc", "2", "10"), buy("gold", "5", "10")],
      previousPrices: { ETF: "10", BTC: "10", GOLD: "10" },
      currentPrices: { ETF: "11", BTC: "12", GOLD: "8" },
      strategy: null,
    }));

    expect(result.positiveContributors.map((item) => [item.symbol, item.contribution])).toEqual([
      ["ETF", "10.00"],
      ["BTC", "4.00"],
    ]);
    expect(result.negativeContributors.map((item) => [item.symbol, item.contribution])).toEqual([
      ["GOLD", "-10.00"],
    ]);
  });

  it("does not attribute a same-day purchase to market movement", () => {
    const result = calculateDailyBrief(makeInput({
      transactions: [buy("etf", "10", "10"), { ...buy("etf", "2", "11"), id: "today", executedAt: "2026-08-29T08:00:00Z" }],
      currentPrices: { ETF: "11" },
    }));

    expect(result.positiveContributors[0]).toEqual(expect.objectContaining({ symbol: "ETF", contribution: "10.00" }));
  });
});

function makeInput(overrides: {
  assets?: EngineAsset[];
  transactions?: EngineTransaction[];
  previousPrices?: Record<string, string>;
  currentPrices?: Record<string, string>;
  strategy?: EngineStrategyAllocation[] | null;
  previousStale?: boolean;
} = {}): CalculateDailyBriefInput {
  return {
    assets: overrides.assets ?? [etf],
    accounts: [{ id: "account", name: "Broker", type: "BROKER" }],
    transactions: overrides.transactions ?? [buy("etf", "10", "10")],
    baseCurrency: "USD",
    currentMarketPrices: overrides.currentPrices ?? { ETF: "10" },
    currentHasStalePrices: false,
    history: [{ date: "2026-08-28", marketPrices: overrides.previousPrices ?? { ETF: "10" }, hasStalePrices: overrides.previousStale ?? false }],
    strategy: overrides.strategy === undefined ? [{ assetClass: AssetClass.ETF, targetPercent: "100", minPercent: "90", maxPercent: "100" }] : overrides.strategy,
    rules: {
      preferContributionsOverSelling: true,
      challengeStrategyViolations: true,
      preferNoActionWhenEvidenceWeak: true,
      minimumRebalanceDrift: "2",
    },
    asOf: "2026-08-29T12:00:00Z",
  };
}

function buy(assetId: string, quantity: string, price: string): EngineTransaction {
  return {
    id: `buy-${assetId}-${quantity}`,
    assetId,
    accountId: "account",
    type: TransactionType.BUY,
    quantity,
    pricePerUnit: price,
    currency: "USD",
    executedAt: "2026-08-27T12:00:00Z",
  };
}

function twoClassStrategy(): EngineStrategyAllocation[] {
  return [
    { assetClass: AssetClass.ETF, targetPercent: "90", minPercent: "80", maxPercent: "95" },
    { assetClass: AssetClass.CRYPTO, targetPercent: "10", minPercent: "5", maxPercent: "15" },
  ];
}
