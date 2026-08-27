import { AssetClass, AssetType, TransactionGroupKind, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateAssetNetCostBasis,
  calculateHoldings,
  calculateHoldingCostBasis,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  calculateStrategyAlignment,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  planContribution,
  buildContributionProjection,
  projectCustomContribution,
  simulateContribution,
  simulateTransaction,
  validateStrategy,
  validateStrategyAssetAllocations,
  type ContributionAllocation,
  type EngineAsset,
  type EngineStrategyAllocation,
  type EngineTransaction,
  type PortfolioSnapshot,
} from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";

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
  { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "72", maxPercent: "82", assetAllocations: [{ assetId: "etf", targetPercent: "100" }] },
  {
    assetClass: AssetClass.CRYPTO,
    targetPercent: "12",
    minPercent: "8",
    maxPercent: "15",
    assetAllocations: [
      { assetId: "btc", targetPercent: "70" },
      { assetId: "eth", targetPercent: "30" },
    ],
  },
  {
    assetClass: AssetClass.GOLD,
    targetPercent: "9",
    minPercent: "7",
    maxPercent: "15",
    assetAllocations: [
      { assetId: "gold", targetPercent: "60" },
      { assetId: "xaut", targetPercent: "40" },
    ],
  },
  {
    assetClass: AssetClass.CASH,
    targetPercent: "2",
    minPercent: "0",
    maxPercent: "5",
    assetAllocations: [
      { assetId: "eur", targetPercent: "50" },
      { assetId: "usdt", targetPercent: "50" },
    ],
  },
];

const strategyWithoutCash: EngineStrategyAllocation[] = [
  { assetClass: AssetClass.ETF, targetPercent: "78", minPercent: "70", maxPercent: "85", assetAllocations: [{ assetId: "etf", targetPercent: "100" }] },
  {
    assetClass: AssetClass.CRYPTO,
    targetPercent: "12",
    minPercent: "8",
    maxPercent: "20",
    assetAllocations: [
      { assetId: "btc", targetPercent: "70" },
      { assetId: "eth", targetPercent: "30" },
    ],
  },
  {
    assetClass: AssetClass.GOLD,
    targetPercent: "10",
    minPercent: "5",
    maxPercent: "15",
    assetAllocations: [
      { assetId: "gold", targetPercent: "60" },
      { assetId: "xaut", targetPercent: "40" },
    ],
  },
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

  it("accepts a strategy without CASH", () => {
    expect(() => validateStrategy(strategyWithoutCash)).not.toThrow();
  });

  it("validates nested asset targets", () => {
    expect(() => validateStrategyAssetAllocations(strategyWithoutCash, assets)).not.toThrow();
    expect(() => validateStrategyAssetAllocations([
      { ...strategyWithoutCash[0], assetAllocations: [{ assetId: "etf", targetPercent: "90" }] },
      ...strategyWithoutCash.slice(1),
    ], assets)).toThrow("asset targets must total exactly 100%");
    expect(() => validateStrategyAssetAllocations([
      { ...strategyWithoutCash[0], assetAllocations: [{ assetId: "btc", targetPercent: "100" }] },
      ...strategyWithoutCash.slice(1),
    ], assets)).toThrow("must match parent ETF allocation");
  });

  it("rejects duplicate, out-of-bounds, and non-finite strategy allocations", () => {
    expect(() => validateStrategy([
      ...strategy.slice(0, 3),
      { ...strategy[3], assetClass: AssetClass.GOLD },
    ])).toThrow("only one GOLD");
    expect(() => validateStrategy(strategy.map((item) => item.assetClass === AssetClass.ETF
      ? { ...item, minPercent: "-1", targetPercent: "77", maxPercent: "82" }
      : item))).toThrow("between 0 and 100");
    expect(() => validateStrategy(strategy.map((item) => item.assetClass === AssetClass.ETF
      ? { ...item, targetPercent: "NaN" }
      : item))).toThrow("total 100");
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
    const plan = planContribution({ portfolio: before, assets, strategy, contributionAmount: "1000" });

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

  it("plans contributions without CASH when CASH is not in the strategy", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "1000" }),
        transaction({ assetId: "eur", accountId: "bank", type: TransactionType.INITIAL_BALANCE, quantity: "500" }),
      ],
    });
    const projection = buildContributionProjection({ portfolio, assets, strategy: strategyWithoutCash, contributionAmount: "1000" });

    expect(projection.plan.allocations.some((allocation) => allocation.assetClass === AssetClass.CASH)).toBe(false);
    expect(projection.afterComparison.map((comparison) => comparison.assetClass).sort()).toEqual([
      AssetClass.CRYPTO,
      AssetClass.ETF,
      AssetClass.GOLD,
    ].sort());
    expect(contributionSum(projection.plan.allocations)).toBe(1000);
  });

  it("outputs concrete BTC and ETH buy recommendations", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const projection = buildContributionProjection({ portfolio, assets, strategy: strategyWithoutCash, contributionAmount: "1000" });
    const symbols = projection.plan.assetRecommendations.map((recommendation) => recommendation.symbol);

    expect(symbols).toEqual(expect.arrayContaining(["BTC", "ETH"]));
    expect(projection.plan.assetRecommendations.find((recommendation) => recommendation.symbol === "BTC")?.assetClass).toBe(AssetClass.CRYPTO);
    expect(projection.plan.assetRecommendations.reduce((sum, recommendation) => sum + Number(recommendation.amount), 0)).toBe(1000);
  });

  it("sends more class money to the underweight asset within a class", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [
        transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "9000" }),
        transaction({ assetId: "gold", accountId: "storage", type: TransactionType.INITIAL_BALANCE, quantity: "900" }),
        transaction({ assetId: "eth", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "0.1" }),
      ],
    });
    const plan = planContribution({ portfolio, assets, strategy: strategyWithoutCash, contributionAmount: "1000" });
    const btcAmount = Number(plan.assetRecommendations.find((recommendation) => recommendation.symbol === "BTC")?.amount ?? 0);
    const ethAmount = Number(plan.assetRecommendations.find((recommendation) => recommendation.symbol === "ETH")?.amount ?? 0);

    expect(btcAmount).toBeGreaterThan(ethAmount);
  });

  it("returns an empty allocation plan for contribution 0", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const plan = planContribution({ portfolio, assets, strategy, contributionAmount: "0" });

    expect(plan.allocations).toEqual([]);
    expect(plan.contributionAmount).toBe("0.00");
    expect(plan.reasons).toContain("NO_CONTRIBUTION");
  });

  it("rounds contribution allocations to cents while preserving the exact contribution amount", () => {
    const evenStrategy: EngineStrategyAllocation[] = [
      { assetClass: AssetClass.ETF, targetPercent: "25", minPercent: "0", maxPercent: "100", assetAllocations: [{ assetId: "etf", targetPercent: "100" }] },
      { assetClass: AssetClass.CRYPTO, targetPercent: "25", minPercent: "0", maxPercent: "100", assetAllocations: [{ assetId: "btc", targetPercent: "100" }] },
      { assetClass: AssetClass.GOLD, targetPercent: "25", minPercent: "0", maxPercent: "100", assetAllocations: [{ assetId: "gold", targetPercent: "100" }] },
      { assetClass: AssetClass.CASH, targetPercent: "25", minPercent: "0", maxPercent: "100", assetAllocations: [{ assetId: "eur", targetPercent: "100" }] },
    ];
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const plan = planContribution({ portfolio, assets, strategy: evenStrategy, contributionAmount: "0.05" });

    expect(plan.allocations.reduce((sum, allocation) => sum + Math.round(Number(allocation.amount) * 100), 0)).toBe(5);
    expect(plan.allocations.every((allocation) => /^\d+\.\d{2}$/.test(allocation.amount))).toBe(true);
  });

  it("keeps cent totals exact above JavaScript's safe integer range", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const contributionAmount = "9007199254740993.01";
    const plan = planContribution({ portfolio, assets, strategy, contributionAmount });
    const total = plan.allocations.reduce((sum, allocation) => sum.plus(decimal(allocation.amount)), ZERO);

    expect(total.toFixed(2)).toBe(contributionAmount);
  });

  it("preserves OTHER asset value in projected portfolio totals", () => {
    const otherAsset: EngineAsset = { id: "other", symbol: "OTHER_ASSET", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER };
    const portfolio = calculatePortfolio({
      assets: [...assets, otherAsset],
      marketPrices: { ...prices, OTHER_ASSET: "100" },
      transactions: [transaction({ assetId: "other", accountId: "wallet", type: TransactionType.INITIAL_BALANCE, quantity: "10" })],
    });
    const plan = planContribution({ portfolio, assets, strategy, contributionAmount: "100" });

    expect(portfolio.totalValue).toBe("1000.00");
    expect(plan.projectedAfter.totalValue).toBe("1100.00");
    expect(plan.projectedAfter.allocation.reduce((sum, item) => sum.plus(decimal(item.value)), ZERO).toFixed(2)).toBe("1100.00");
  });

  it("projects an exact custom contribution without changing the source portfolio", () => {
    const portfolio = calculatePortfolio({
      assets,
      marketPrices: prices,
      transactions: [transaction({ assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "1000" })],
    });
    const projection = projectCustomContribution({
      portfolio,
      assets,
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

  it("projects a custom contribution using only active strategy classes", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const projection = projectCustomContribution({
      portfolio,
      assets,
      strategy: strategyWithoutCash,
      contributionAmount: "100.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "78.00" },
        { assetClass: AssetClass.CRYPTO, amount: "12.00" },
        { assetClass: AssetClass.GOLD, amount: "10.00" },
      ],
    });

    expect(projection.plan.allocations.map((allocation) => allocation.assetClass)).toEqual([
      AssetClass.ETF,
      AssetClass.CRYPTO,
      AssetClass.GOLD,
    ]);
    expect(() => projectCustomContribution({
      portfolio,
      assets,
      strategy: strategyWithoutCash,
      contributionAmount: "100.00",
      allocations: [
        { assetClass: AssetClass.ETF, amount: "78.00" },
        { assetClass: AssetClass.CRYPTO, amount: "12.00" },
        { assetClass: AssetClass.GOLD, amount: "9.00" },
        { assetClass: AssetClass.CASH, amount: "1.00" },
      ],
    })).toThrow("not enabled");
  });

  it("rejects invalid custom totals, duplicate classes, sub-cent amounts, and non-finite inputs", () => {
    const portfolio = calculatePortfolio({ assets, marketPrices: prices, transactions: [] });
    const valid = [
      { assetClass: AssetClass.ETF, amount: "70.00" },
      { assetClass: AssetClass.CRYPTO, amount: "20.00" },
      { assetClass: AssetClass.GOLD, amount: "10.00" },
      { assetClass: AssetClass.CASH, amount: "0.00" },
    ];

    expect(() => projectCustomContribution({ portfolio, assets, strategy, contributionAmount: "101.00", allocations: valid })).toThrow("equal the contribution amount");
    expect(() => projectCustomContribution({ portfolio, assets, strategy, contributionAmount: "100.00", allocations: [...valid.slice(0, 3), { assetClass: AssetClass.GOLD, amount: "0.00" }] })).toThrow("only one GOLD");
    expect(() => projectCustomContribution({ portfolio, assets, strategy, contributionAmount: "100.001", allocations: valid })).toThrow("at most two decimal places");
    expect(() => planContribution({ portfolio, assets, strategy, contributionAmount: Number.NaN })).toThrow("finite amount");
    expect(() => planContribution({ portfolio, assets, strategy, contributionAmount: "-1" })).toThrow("cannot be negative");
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
      assets,
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
    const projection = buildContributionProjection({ portfolio, assets, strategy, contributionAmount: "1000" });

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

describe("portfolio engine dashboard analytics", () => {
  it("calculates transparent alignment points and returns no score for an empty portfolio", () => {
    const portfolio = calculatePortfolio({ assets, transactions: [], marketPrices: prices });
    const comparisons = compareAllocationToStrategy(portfolio, strategy);
    const empty = calculateStrategyAlignment({ comparisons, pricedHoldings: 0, totalHoldings: 0 });
    const complete = calculateStrategyAlignment({
      comparisons: comparisons.map((comparison) => ({ ...comparison, status: "IN_RANGE" as const })),
      pricedHoldings: 4,
      totalHoldings: 4,
    });
    const partial = calculateStrategyAlignment({
      comparisons: comparisons.map((comparison, index) => ({ ...comparison, status: index === 0 ? "OVERWEIGHT" as const : "IN_RANGE" as const })),
      pricedHoldings: 2,
      totalHoldings: 4,
    });

    expect(empty).toEqual(expect.objectContaining({ score: null, allocationPoints: 0, inRangeClasses: 0 }));
    expect(complete).toEqual(expect.objectContaining({ score: 100, allocationPoints: 80, priceDataPoints: 20 }));
    expect(partial).toEqual(expect.objectContaining({ score: 70, allocationPoints: 60, priceDataPoints: 10 }));
  });

  it("calculates strict unrealized P&L and account values when coverage is complete", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "etf", accountId: "broker", type: TransactionType.INITIAL_BALANCE, quantity: "100", pricePerUnit: "10", currency: "EUR", executedAt: "2026-01-01" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: { ...prices, VWCE: "12" } });
    const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: "EUR" });

    expect(analytics.totalUnrealizedPnl).toBe("200.00");
    expect(analytics.accounts).toContainEqual({ accountId: "broker", value: "1200.00", isPartial: false });
    expect(analytics.priceCoverage).toEqual({ pricedHoldings: 1, totalHoldings: 1, percent: "100.00" });
  });

  it("returns a negative unrealized P&L without changing its sign", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "etf", accountId: "broker", type: TransactionType.BUY, quantity: "10", pricePerUnit: "20", currency: "EUR" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: { ...prices, VWCE: "15" } });
    expect(calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: "EUR" }).totalUnrealizedPnl).toBe("-50.00");
  });

  it("withholds total P&L for missing prices, missing cost, unmatched transfers, and foreign cost currency", () => {
    const baseTransaction: EngineTransaction = { assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: "5000", currency: "EUR", executedAt: "2026-01-01" };
    const cases: Array<{ transactions: EngineTransaction[]; marketPrices: Record<string, string> }> = [
      { transactions: [baseTransaction], marketPrices: {} },
      { transactions: [{ ...baseTransaction, pricePerUnit: null }], marketPrices: { BTC: "10000" } },
      { transactions: [baseTransaction, { assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.1", executedAt: "2026-01-02" }], marketPrices: { BTC: "10000" } },
      { transactions: [{ ...baseTransaction, currency: "USD" }], marketPrices: { BTC: "10000" } },
    ];

    for (const item of cases) {
      const portfolio = calculatePortfolio({ assets, transactions: item.transactions, marketPrices: item.marketPrices });
      expect(calculatePortfolioAnalytics({ portfolio, assets, transactions: item.transactions, baseCurrency: "EUR" }).totalUnrealizedPnl).toBeNull();
    }
  });

  it("preserves global cost basis across matched transfers and treats base EUR fiat as zero P&L", () => {
    const engineAssets: EngineAsset[] = assets.map((asset) => asset.id === "eur" ? { ...asset, currency: "EUR" } : asset);
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: "5000", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_OUT, quantity: "0.4", executedAt: "2026-01-02" },
      { assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.4", executedAt: "2026-01-02" },
      { assetId: "eur", accountId: "bank", type: TransactionType.INITIAL_BALANCE, quantity: "1000", pricePerUnit: null, currency: "EUR", executedAt: "2026-01-01" },
    ];
    const portfolio = calculatePortfolio({ assets: engineAssets, transactions, marketPrices: { BTC: "10000", EUR: "1" } });
    const analytics = calculatePortfolioAnalytics({ portfolio, assets: engineAssets, transactions, baseCurrency: "EUR" });

    expect(analytics.totalUnrealizedPnl).toBe("5000.00");
    expect(analytics.accounts).toEqual(expect.arrayContaining([
      { accountId: "bybit", value: "6000.00", isPartial: false },
      { accountId: "wallet", value: "4000.00", isPartial: false },
      { accountId: "bank", value: "1000.00", isPartial: false },
    ]));
  });

  it("keeps allocation unchanged and carries holding cost basis across transfers", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "1", pricePerUnit: "10000", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_OUT, quantity: "0.4", currency: "EUR", executedAt: "2026-01-02" },
      { assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.4", currency: "EUR", executedAt: "2026-01-02" },
    ];
    const before = calculatePortfolio({ assets, transactions: [transactions[0]], marketPrices: prices });
    const after = calculatePortfolio({ assets, transactions, marketPrices: prices });
    const basis = calculateHoldingCostBasis({ portfolio: after, assets, transactions, baseCurrency: "EUR" });

    expect(before.totalValue).toBe(after.totalValue);
    expect(allocationFor(before, AssetClass.CRYPTO).percentage).toBe(allocationFor(after, AssetClass.CRYPTO).percentage);
    expect(basis.find((row) => row.accountId === "wallet" && row.assetId === "btc")).toEqual(expect.objectContaining({
      status: "AVAILABLE",
      totalCost: "4000.00",
      averageAcquisitionPrice: "10000.00",
    }));
  });

  it("marks unmatched manual transfer rows as unavailable cost basis", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "wallet", type: TransactionType.TRANSFER_IN, quantity: "0.4", currency: "EUR", executedAt: "2026-01-02" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: prices });
    const basis = calculateHoldingCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" });

    expect(basis[0]).toEqual(expect.objectContaining({
      status: "UNAVAILABLE",
      reason: "ACCOUNT_TRANSFER_COST_UNKNOWN",
    }));
  });

  it("uses deposits and withdrawals for net invested and simple return", () => {
    const engineAssets = assets.map((asset) => asset.id === "eur" ? { ...asset, currency: "EUR" } : asset);
    const transactions: EngineTransaction[] = [
      { assetId: "eur", accountId: "bank", type: TransactionType.DEPOSIT, quantity: "1000", pricePerUnit: "1", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "eur", accountId: "bank", type: TransactionType.WITHDRAWAL, quantity: "200", pricePerUnit: "1", currency: "EUR", executedAt: "2026-01-02" },
    ];
    const portfolio = calculatePortfolio({ assets: engineAssets, transactions, marketPrices: { EUR: "1" } });
    const analytics = calculatePortfolioAnalytics({ portfolio, assets: engineAssets, transactions, baseCurrency: "EUR" });

    expect(analytics.externalContributions).toBe("1000.00");
    expect(analytics.externalWithdrawals).toBe("200.00");
    expect(analytics.netInvested).toBe("800.00");
    expect(analytics.totalUnrealizedPnl).toBe("0.00");
    expect(analytics.simpleReturnPercent).toBe("0.00");
  });

  it("marks an account partial while preserving its available value", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "mixed", type: TransactionType.INITIAL_BALANCE, quantity: "1" },
      { assetId: "gold", accountId: "mixed", type: TransactionType.INITIAL_BALANCE, quantity: "10" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: { BTC: "10000" } });
    const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: "EUR" });

    expect(analytics.accounts).toContainEqual({ accountId: "mixed", value: "10000.00", isPartial: true });
    expect(analytics.priceCoverage).toEqual({ pricedHoldings: 1, totalHoldings: 2, percent: "50.00" });
  });
});

describe("portfolio engine holding cost basis", () => {
  it("calculates weighted-average cost after a partial sell", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "2", pricePerUnit: "100", fee: "2", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.SELL, quantity: "0.5", pricePerUnit: "150", currency: "EUR", executedAt: "2026-02-01" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: prices });

    expect(calculateHoldingCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" })).toContainEqual({
      accountId: "bybit",
      assetId: "btc",
      status: "AVAILABLE",
      totalCost: "151.50",
      averageAcquisitionPrice: "101.00",
      reason: null,
    });
  });

  it("withholds per-account cost basis for transfers, foreign currencies, missing prices, and negative holdings", () => {
    const cases: Array<{ transactions: EngineTransaction[]; reason: string }> = [
      { transactions: [{ assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_IN, quantity: "1", currency: "EUR" }], reason: "ACCOUNT_TRANSFER_COST_UNKNOWN" },
      { transactions: [{ assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "1", pricePerUnit: "100", currency: "USD" }], reason: "UNSUPPORTED_TRANSACTION_CURRENCY" },
      { transactions: [{ assetId: "btc", accountId: "bybit", type: TransactionType.INITIAL_BALANCE, quantity: "1", currency: "EUR" }], reason: "MISSING_ACQUISITION_PRICE" },
      { transactions: [{ assetId: "btc", accountId: "bybit", type: TransactionType.SELL, quantity: "1", pricePerUnit: "100", currency: "EUR" }], reason: "NON_POSITIVE_HOLDING" },
    ];

    for (const item of cases) {
      const portfolio = calculatePortfolio({ assets, transactions: item.transactions, marketPrices: prices });
      expect(calculateHoldingCostBasis({ portfolio, assets, transactions: item.transactions, baseCurrency: "EUR" })[0]).toEqual(
        expect.objectContaining({ status: "UNAVAILABLE", reason: item.reason, totalCost: null }),
      );
    }
  });

  it("treats base-currency fiat as zero-P&L cost basis", () => {
    const engineAssets = assets.map((asset) => asset.id === "eur" ? { ...asset, currency: "EUR" } : asset);
    const transactions: EngineTransaction[] = [
      { assetId: "eur", accountId: "bank", type: TransactionType.DEPOSIT, quantity: "500", currency: "EUR" },
      { assetId: "eur", accountId: "bank", type: TransactionType.WITHDRAWAL, quantity: "125", currency: "EUR" },
    ];
    const portfolio = calculatePortfolio({ assets: engineAssets, transactions, marketPrices: prices });
    expect(calculateHoldingCostBasis({ portfolio, assets: engineAssets, transactions, baseCurrency: "EUR" })[0]).toEqual(
      expect.objectContaining({ status: "AVAILABLE", totalCost: "375.00", averageAcquisitionPrice: "1.00" }),
    );
  });
});

describe("portfolio engine asset net cost basis", () => {
  it("reduces average net cost after a partial sell", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "2", pricePerUnit: "100", fee: "2", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.SELL, quantity: "0.5", pricePerUnit: "150", currency: "EUR", executedAt: "2026-02-01" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: prices });

    expect(calculateAssetNetCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" })).toContainEqual({
      assetId: "btc",
      status: "AVAILABLE",
      netCost: "127.00",
      averageNetCost: "84.67",
      reason: null,
    });
    expect(calculateHoldingCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" })).toContainEqual(
      expect.objectContaining({ assetId: "btc", averageAcquisitionPrice: "101.00" }),
    );
  });

  it("handles reinvested proceeds and sell fees without double-counting new capital", () => {
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "1", pricePerUnit: "100", currency: "EUR" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.SELL, quantity: "0.5", pricePerUnit: "200", fee: "5", currency: "EUR" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "0.5", pricePerUnit: "200", fee: "1", currency: "EUR" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: prices });

    expect(calculateAssetNetCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" })).toContainEqual(
      expect.objectContaining({ assetId: "btc", status: "AVAILABLE", netCost: "106.00", averageNetCost: "106.00" }),
    );
  });

  it("keeps paired transfers neutral and rejects transfer-only assets", () => {
    const transferred: EngineTransaction[] = [
      { assetId: "btc", accountId: "bybit", type: TransactionType.BUY, quantity: "1", pricePerUnit: "100", currency: "EUR" },
      { assetId: "btc", accountId: "bybit", type: TransactionType.TRANSFER_OUT, quantity: "0.4", currency: "EUR" },
      { assetId: "btc", accountId: "ledger", type: TransactionType.TRANSFER_IN, quantity: "0.4", currency: "EUR" },
    ];
    const transferredPortfolio = calculatePortfolio({ assets, transactions: transferred, marketPrices: prices });
    expect(calculateAssetNetCostBasis({ portfolio: transferredPortfolio, assets, transactions: transferred, baseCurrency: "EUR" })).toContainEqual(
      expect.objectContaining({ assetId: "btc", status: "AVAILABLE", netCost: "100.00", averageNetCost: "100.00" }),
    );

    const transferOnly: EngineTransaction[] = [
      { assetId: "btc", accountId: "ledger", type: TransactionType.TRANSFER_IN, quantity: "1", currency: "EUR" },
    ];
    const transferOnlyPortfolio = calculatePortfolio({ assets, transactions: transferOnly, marketPrices: prices });
    expect(calculateAssetNetCostBasis({ portfolio: transferOnlyPortfolio, assets, transactions: transferOnly, baseCurrency: "EUR" })).toContainEqual(
      expect.objectContaining({ assetId: "btc", status: "UNAVAILABLE", netCost: null, averageNetCost: null }),
    );
  });

  it("uses durable group identity when carrying transfer cost between accounts", () => {
    const grouped = (id: string) => ({ id, kind: TransactionGroupKind.TRANSFER });
    const transactions: EngineTransaction[] = [
      { assetId: "btc", accountId: "cheap", type: TransactionType.BUY, quantity: "1", pricePerUnit: "100", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "expensive", type: TransactionType.BUY, quantity: "1", pricePerUnit: "200", currency: "EUR", executedAt: "2026-01-01" },
      { assetId: "btc", accountId: "cheap", type: TransactionType.TRANSFER_OUT, quantity: "1", transactionGroupId: "cheap-group", transactionGroup: grouped("cheap-group"), executedAt: "2026-01-02" },
      { assetId: "btc", accountId: "expensive", type: TransactionType.TRANSFER_OUT, quantity: "1", transactionGroupId: "expensive-group", transactionGroup: grouped("expensive-group"), executedAt: "2026-01-02" },
      { assetId: "btc", accountId: "expensive-wallet", type: TransactionType.TRANSFER_IN, quantity: "1", transactionGroupId: "expensive-group", transactionGroup: grouped("expensive-group"), executedAt: "2026-01-02" },
      { assetId: "btc", accountId: "cheap-wallet", type: TransactionType.TRANSFER_IN, quantity: "1", transactionGroupId: "cheap-group", transactionGroup: grouped("cheap-group"), executedAt: "2026-01-02" },
    ];
    const portfolio = calculatePortfolio({ assets, transactions, marketPrices: prices });
    const basis = calculateHoldingCostBasis({ portfolio, assets, transactions, baseCurrency: "EUR" });
    expect(basis).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "cheap-wallet", totalCost: "100.00" }),
      expect.objectContaining({ accountId: "expensive-wallet", totalCost: "200.00" }),
    ]));
  });
});
