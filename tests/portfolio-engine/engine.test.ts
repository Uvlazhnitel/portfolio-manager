import { AssetClass, AssetType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateHoldings,
  calculatePortfolio,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  planContribution,
  buildContributionProjection,
  projectCustomContribution,
  simulateContribution,
  simulateTransaction,
  validateStrategy,
  type ContributionAllocation,
  type EngineAsset,
  type EngineStrategyAllocation,
  type EngineTransaction,
  type PortfolioSnapshot,
} from "@/features/portfolio-engine";

const assets: EngineAsset[] = [
  { id: "btc", symbol: "BTC", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO },
  { id: "eth", symbol: "ETH", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO },
  { id: "etf", symbol: "VWCE", assetClass: AssetClass.ETF, assetType: AssetType.ETF },
  { id: "gold", symbol: "PHYSICAL_GOLD", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD },
  { id: "xaut", symbol: "XAUT", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD },
  { id: "eur", symbol: "EUR", assetClass: AssetClass.CASH, assetType: AssetType.FIAT },
  { id: "usdt", symbol: "USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN },
];

const strategy: EngineStrategyAllocation[] = [
  { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "72", maxPercent: "82" },
  { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
  { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
  { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
];

const prices = {
  BTC: "10000",
  ETH: "2000",
  VWCE: "1",
  PHYSICAL_GOLD: "1",
  XAUT: "1",
  EUR: "1",
  USDT: "1",
};

function transaction(input: Omit<EngineTransaction, "id">): EngineTransaction {
  return input;
}

function allocationFor(portfolio: PortfolioSnapshot, assetClass: AssetClass) {
  const allocation = portfolio.allocation.find((item) => item.assetClass === assetClass);
  expect(allocation).toBeDefined();
  return allocation!;
}

function contributionSum(allocations: ContributionAllocation[]) {
  return allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
}

describe("portfolio engine holdings", () => {
  it("returns empty holdings and zero allocation for an empty portfolio", () => {
    const portfolio = calculatePortfolio({ assets, transactions: [], marketPrices: prices });

    expect(portfolio.holdings).toEqual([]);
    expect(portfolio.totalValue).toBe("0.00");
    expect(portfolio.allocation.every((allocation) => allocation.percentage === "0.00")).toBe(true);
  });

  it("handles portfolio value 0 without division errors", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: { ...prices, BTC: "0" },
      transactions: [transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" })],
    });

    expect(portfolio.totalValue).toBe("0.00");
    expect(allocationFor(portfolio, AssetClass.CRYPTO).percentage).toBe("0.00");
  });

  it("derives holdings from initial balances, buys, sells, deposits, withdrawals, and transfers", () => {
    const holdings = calculateHoldings([
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "0.5" }),
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.SELL, quantity: "0.2" }),
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.DEPOSIT, quantity: "0.3" }),
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.WITHDRAWAL, quantity: "0.1" }),
      transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_OUT, quantity: "0.4" }),
      transaction({ assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.4" }),
    ]);

    expect(holdings).toEqual([
      { accountId: "bybit", assetId: "btc", quantity: "1.1" },
      { accountId: "wallet", assetId: "btc", quantity: "0.4" },
    ]);
  });

  it("does not change global allocation for transfers between accounts", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_OUT, quantity: "0.4" }),
        transaction({ assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.4" }),
      ],
    });

    expect(portfolio.totalValue).toBe("10000.00");
    expect(allocationFor(portfolio, AssetClass.CRYPTO).percentage).toBe("100.00");
  });
});

describe("portfolio engine allocation and compliance", () => {
  it("values holdings and calculates total portfolio value", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "9000" }),
      ],
    });

    expect(portfolio.totalValue).toBe("19000.00");
    expect(allocationFor(portfolio, AssetClass.CRYPTO).value).toBe("10000.00");
    expect(allocationFor(portfolio, AssetClass.ETF).value).toBe("9000.00");
  });

  it("marks an asset class exactly at target as in range", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "77" }),
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.0012" }),
        transaction({ assetId: "gold", accountId: "storage", type: TransactionType.INITIAL_BALANCE, quantity: "9" }),
        transaction({ assetId: "eur", accountId: "bank", type: TransactionType.INITIAL_BALANCE, quantity: "2" }),
      ],
    });

    const comparisons = compareAllocationToStrategy(portfolio, strategy);
    expect(comparisons.find((comparison) => comparison.assetClass === AssetClass.ETF)?.status).toBe("IN_RANGE");
    expect(comparisons.find((comparison) => comparison.assetClass === AssetClass.ETF)?.driftFromTarget).toBe("0.00");
  });

  it("marks an asset class exactly at max as in range", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.0015" }),
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "85" }),
      ],
    });

    expect(compareAllocationToStrategy(portfolio, strategy).find((item) => item.assetClass === AssetClass.CRYPTO)?.status).toBe(
      "IN_RANGE",
    );
  });

  it("returns crypto overweight warnings above max range", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.17" }),
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "8300" }),
      ],
    });

    expect(evaluateStrategyCompliance(portfolio, strategy)).toContainEqual({
      code: "CRYPTO_ABOVE_MAX",
      assetClass: AssetClass.CRYPTO,
      currentPercent: "17.00",
      limitPercent: "15.00",
      reasonCodes: ["ASSET_CLASS_OVERWEIGHT", "ABOVE_MAX_RANGE"],
    });
  });

  it("classifies physical gold as GOLD and stablecoin as CASH through asset metadata", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "gold", accountId: "storage", type: TransactionType.INITIAL_BALANCE, quantity: "100" }),
        transaction({ assetId: "usdt", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "50" }),
      ],
    });

    expect(allocationFor(portfolio, AssetClass.GOLD).value).toBe("100.00");
    expect(allocationFor(portfolio, AssetClass.CASH).value).toBe("50.00");
  });

  it("rejects strategy totals that are not 100", () => {
    expect(() =>
      validateStrategy([
        { assetClass: AssetClass.ETF, targetPercent: "80", minPercent: "72", maxPercent: "82" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
      ]),
    ).toThrow("Strategy target allocations must total 100%.");
  });
});

describe("portfolio engine contribution planning and simulation", () => {
  it("prioritizes underweight classes and avoids strongly overweight classes", () => {
    const before = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "6000" }),
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.25" }),
        transaction({ assetId: "gold", accountId: "storage", type: TransactionType.INITIAL_BALANCE, quantity: "1000" }),
        transaction({ assetId: "eur", accountId: "bank", type: TransactionType.INITIAL_BALANCE, quantity: "500" }),
      ],
    });
    const plan = planContribution({ portfolio: before, strategy, contributionAmount: "1000" });

    expect(contributionSum(plan.allocations)).toBe(1000);
    expect(plan.allocations.find((allocation) => allocation.assetClass === AssetClass.CRYPTO)).toBeUndefined();
    expect(Number(allocationFor(plan.projectedAfter, AssetClass.ETF).percentage)).toBeGreaterThan(60);
    expect(plan.reasons).toContain("NO_SELL_REQUIRED");
  });

  it("handles a portfolio with no ETF yet", () => {
    const plan = simulateContribution({
      assets,
      marketPrices: prices,
      strategy,
      contributionAmount: "1000",
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
        transaction({ assetId: "gold", accountId: "storage", type: TransactionType.INITIAL_BALANCE, quantity: "1000" }),
      ],
    });

    expect(Number(plan.allocations.find((allocation) => allocation.assetClass === AssetClass.ETF)?.amount ?? 0)).toBeGreaterThan(0);
  });

  it("handles contribution larger than the existing portfolio", () => {
    const plan = simulateContribution({
      assets,
      marketPrices: prices,
      strategy,
      contributionAmount: "10000",
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.1" }),
      ],
    });

    expect(contributionSum(plan.allocations)).toBe(10000);
    expect(Number(allocationFor(plan.projectedAfter, AssetClass.ETF).percentage)).toBeGreaterThan(50);
  });

  it("returns an empty allocation plan for contribution 0", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const plan = planContribution({ portfolio, strategy, contributionAmount: "0" });

    expect(plan.allocations).toEqual([]);
    expect(plan.contributionAmount).toBe("0.00");
    expect(plan.reasons).toContain("NO_CONTRIBUTION");
  });

  it("rounds contribution allocations to cents while preserving the exact contribution amount", () => {
    const evenStrategy: EngineStrategyAllocation[] = [
      { assetClass: AssetClass.ETF, targetPercent: "25", minPercent: "0", maxPercent: "100" },
      { assetClass: AssetClass.CRYPTO, targetPercent: "25", minPercent: "0", maxPercent: "100" },
      { assetClass: AssetClass.GOLD, targetPercent: "25", minPercent: "0", maxPercent: "100" },
      { assetClass: AssetClass.CASH, targetPercent: "25", minPercent: "0", maxPercent: "100" },
    ];
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const plan = planContribution({ portfolio, strategy: evenStrategy, contributionAmount: "0.05" });

    expect(plan.allocations.reduce((sum, allocation) => sum + Math.round(Number(allocation.amount) * 100), 0)).toBe(5);
    expect(plan.allocations.every((allocation) => /^\d+\.\d{2}$/.test(allocation.amount))).toBe(true);
  });

  it("projects an exact custom contribution without changing the source portfolio", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "1000" })],
    });
    const projection = projectCustomContribution({
      portfolio,
      strategy,
      contributionAmount: "100.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "70.00" },
        { assetClass: AssetClass.CRYPTO, amount: "20.00" },
        { assetClass: AssetClass.GOLD, amount: "10.00" },
        { assetClass: AssetClass.CASH, amount: "0.00" },
      ],
    });

    expect(projection.plan.projectedAfter.totalValue).toBe("1100.00");
    expect(projection.plan.before.totalValue).toBe("1000.00");
    expect(projection.plan.allocations.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0)).toBe(10_000);
    expect(projection.isCustomized).toBe(true);
  });

  it("rejects invalid custom totals, duplicate classes, sub-cent amounts, and non-finite inputs", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const valid = [
      { assetClass: AssetClass.ETF, amount: "70.00" },
      { assetClass: AssetClass.CRYPTO, amount: "20.00" },
      { assetClass: AssetClass.GOLD, amount: "10.00" },
      { assetClass: AssetClass.CASH, amount: "0.00" },
    ];

    expect(() => projectCustomContribution({ portfolio, strategy, contributionAmount: "101.00", allocations: valid })).toThrow("equal the contribution amount");
    expect(() => projectCustomContribution({ portfolio, strategy, contributionAmount: "100.00", allocations: [...valid.slice(0, 3), { assetClass: AssetClass.GOLD, amount: "0.00" }] })).toThrow("exactly one GOLD");
    expect(() => projectCustomContribution({ portfolio, strategy, contributionAmount: "100.001", allocations: valid })).toThrow("at most two decimal places");
    expect(() => planContribution({ portfolio, strategy, contributionAmount: Number.NaN })).toThrow("finite amount");
    expect(() => planContribution({ portfolio, strategy, contributionAmount: "-1" })).toThrow("cannot be negative");
  });

  it("returns advisory warnings when custom crypto remains above maximum", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.2" }),
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "8000" }),
      ],
    });
    const projection = projectCustomContribution({
      portfolio,
      strategy,
      contributionAmount: "1000.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "500.00" },
        { assetClass: AssetClass.CRYPTO, amount: "500.00" },
        { assetClass: AssetClass.GOLD, amount: "0.00" },
        { assetClass: AssetClass.CASH, amount: "0.00" },
      ],
    });

    expect(projection.warnings.some((warning) => warning.code === "CRYPTO_ABOVE_MAX")).toBe(true);
    expect(projection.reasons).toContainEqual({ code: "CUSTOM_ALLOCATION_ABOVE_MAX", assetClass: AssetClass.CRYPTO });
  });

  it("adds contextual deterministic reasons to recommendations for partial portfolios", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: { ETF: "1" },
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "1000" }),
      ],
    });
    const projection = buildContributionProjection({ portfolio, strategy, contributionAmount: "1000" });

    expect(projection.plan.before.missingPriceSymbols).toContain("BTC");
    expect(projection.reasons).toContainEqual({ code: "ASSET_CLASS_UNDERWEIGHT", assetClass: AssetClass.GOLD });
  });

  it("simulates buying BTC without creating a database transaction", () => {
    const projected = simulateTransaction({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "1000" }),
      ],
      transaction: transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "0.05" }),
    });

    expect(projected.totalValue).toBe("1500.00");
    expect(allocationFor(projected, AssetClass.CRYPTO).percentage).toBe("33.33");
  });

  it("handles only crypto portfolios", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1" }),
      ],
    });

    expect(allocationFor(portfolio, AssetClass.CRYPTO).percentage).toBe("100.00");
    expect(evaluateStrategyCompliance(portfolio, strategy).some((warning) => warning.code === "CRYPTO_ABOVE_MAX")).toBe(true);
  });
});
