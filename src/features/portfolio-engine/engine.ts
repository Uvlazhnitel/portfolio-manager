import { AssetClass, TransactionType, type Prisma } from "@prisma/client";
import {
  decimal,
  isZero,
  maxDecimal,
  ONE_HUNDRED,
  toDecimalString,
  toQuantityString,
  ZERO,
} from "@/features/portfolio-engine/decimal";
import type {
  AllocationComparison,
  AssetClassAllocation,
  CalculatePortfolioInput,
  CalculatePortfolioAnalyticsInput,
  CalculateHoldingCostBasisInput,
  CalculateHistoricalPerformanceInput,
  CalculateStrategyAlignmentInput,
  ContributionAllocation,
  ContributionAssetRecommendation,
  ContributionPlan,
  ContributionProjection,
  ContributionReason,
  EngineAsset,
  EngineStrategyAllocation,
  EngineTransaction,
  Holding,
  HoldingCostBasis,
  HoldingCostBasisReason,
  PlanContributionInput,
  ProjectContributionInput,
  PortfolioSnapshot,
  PortfolioAnalytics,
  PortfolioPerformancePoint,
  ReasonCode,
  SimulatedTransactionInput,
  SimulateContributionInput,
  StrategyWarning,
  StrategyAlignment,
  ValuedHolding,
} from "@/features/portfolio-engine/types";

const allocationClasses = [
  AssetClass.ETF,
  AssetClass.CRYPTO,
  AssetClass.GOLD,
  AssetClass.CASH,
  AssetClass.OTHER,
] as const;
const allocationClassOrder = new Map<AssetClass, number>(
  allocationClasses.map((assetClass, index) => [assetClass, index]),
);

const positiveQuantityTypes = new Set<TransactionType>([
  TransactionType.INITIAL_BALANCE,
  TransactionType.BUY,
  TransactionType.DEPOSIT,
  TransactionType.TRANSFER_IN,
]);

const negativeQuantityTypes = new Set<TransactionType>([
  TransactionType.SELL,
  TransactionType.WITHDRAWAL,
  TransactionType.TRANSFER_OUT,
]);

export function calculateHoldings(transactions: EngineTransaction[]): Holding[] {
  const quantities = new Map<string, Prisma.Decimal>();

  for (const transaction of transactions) {
    const key = `${transaction.accountId}:${transaction.assetId}`;
    const current = quantities.get(key) ?? ZERO;
    const quantity = decimal(transaction.quantity);

    if (positiveQuantityTypes.has(transaction.type)) {
      quantities.set(key, current.plus(quantity));
    }

    if (negativeQuantityTypes.has(transaction.type)) {
      quantities.set(key, current.minus(quantity));
    }
  }

  return Array.from(quantities.entries())
    .map(([key, quantity]) => {
      const [accountId, assetId] = key.split(":");

      return {
        accountId,
        assetId,
        quantity: toQuantityString(quantity),
      };
    })
    .filter((holding) => !decimal(holding.quantity).equals(ZERO));
}

export function calculatePortfolio(input: CalculatePortfolioInput): PortfolioSnapshot {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const holdings = calculateHoldings(input.transactions);
  const missingPriceSymbols = new Set<string>();

  const valuedHoldings: ValuedHolding[] = holdings.map((holding) => {
    const asset = requireAsset(assetById, holding.assetId);
    const rawPrice = input.marketPrices[asset.symbol];
    const price = rawPrice === undefined ? ZERO : decimal(rawPrice);

    if (rawPrice === undefined) {
      missingPriceSymbols.add(asset.symbol);
    }

    const value = decimal(holding.quantity).mul(price);

    return {
      ...holding,
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      price: toDecimalString(price),
      value: toDecimalString(value),
    };
  });

  const totalValue = valuedHoldings.reduce((total, holding) => total.plus(decimal(holding.value)), ZERO);
  const allocation = calculateAssetClassAllocation(valuedHoldings, totalValue);

  return {
    holdings,
    valuedHoldings,
    totalValue: toDecimalString(totalValue),
    allocation,
    missingPriceSymbols: Array.from(missingPriceSymbols).sort(),
  };
}

export function calculatePortfolioAnalytics(input: CalculatePortfolioAnalyticsInput): PortfolioAnalytics {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const missingSymbols = new Set(input.portfolio.missingPriceSymbols);
  const positiveHoldings = input.portfolio.holdings.filter((holding) => decimal(holding.quantity).greaterThan(ZERO));
  const valuedByHolding = new Map(
    input.portfolio.valuedHoldings.map((holding) => [`${holding.accountId}:${holding.assetId}`, holding]),
  );
  const accountValues = new Map<string, { value: Prisma.Decimal; isPartial: boolean }>();
  let pricedHoldings = 0;

  for (const holding of positiveHoldings) {
    const asset = requireAsset(assetById, holding.assetId);
    const account = accountValues.get(holding.accountId) ?? { value: ZERO, isPartial: false };
    if (missingSymbols.has(asset.symbol)) {
      account.isPartial = true;
    } else {
      const valued = valuedByHolding.get(`${holding.accountId}:${holding.assetId}`);
      account.value = account.value.plus(decimal(valued?.value ?? 0));
      pricedHoldings += 1;
    }
    accountValues.set(holding.accountId, account);
  }

  const totalHoldings = positiveHoldings.length;
  const totalUnrealizedPnl = calculateStrictUnrealizedPnl(input, assetById, missingSymbols);
  const performance = calculatePerformanceSummary(input, assetById);

  return {
    totalUnrealizedPnl: totalUnrealizedPnl ? toDecimalString(totalUnrealizedPnl) : null,
    investmentGain: performance.investmentGain,
    netInvested: performance.netInvested,
    netContributed: performance.netContributed,
    externalContributions: performance.externalContributions,
    externalWithdrawals: performance.externalWithdrawals,
    simpleReturnPercent: performance.simpleReturnPercent,
    isCostBasisPartial: performance.isCostBasisPartial,
    missingCostBasisSymbols: performance.missingCostBasisSymbols,
    isExternalCashflowPartial: performance.isExternalCashflowPartial,
    missingExternalCashflowSymbols: performance.missingExternalCashflowSymbols,
    priceCoverage: {
      pricedHoldings,
      totalHoldings,
      percent: toDecimalString(totalHoldings === 0 ? ZERO : decimal(pricedHoldings).div(totalHoldings).mul(ONE_HUNDRED)),
    },
    accounts: [...accountValues.entries()].map(([accountId, account]) => ({
      accountId,
      value: toDecimalString(account.value),
      isPartial: account.isPartial,
    })),
  };
}

export function calculateHistoricalPerformance(
  input: CalculateHistoricalPerformanceInput,
): PortfolioPerformancePoint[] {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const snapshots = [...input.snapshots].sort((left, right) => left.date.localeCompare(right.date));

  return snapshots
    .map((snapshot) => {
      const dayEnd = Date.parse(`${snapshot.date}T23:59:59.999Z`);
      if (!Number.isFinite(dayEnd)) throw new Error(`Invalid historical snapshot date ${snapshot.date}.`);
      const transactions = transactionsThrough(input.transactions, dayEnd);
      const portfolio = calculatePortfolio({
        assets: input.assets,
        transactions,
        marketPrices: snapshot.marketPrices,
      });
      const performance = calculatePerformanceSummary(
        { portfolio, assets: input.assets, transactions, baseCurrency: input.baseCurrency },
        assetById,
      );
      const isComplete = portfolio.missingPriceSymbols.length === 0;
      const portfolioValue = isComplete ? decimal(portfolio.totalValue) : null;

      return {
        date: snapshot.date,
        portfolioValue: portfolioValue ? toDecimalString(portfolioValue) : null,
        netInvested: performance.netInvested,
        investmentGain: performance.investmentGain,
        simpleReturnPercent: performance.simpleReturnPercent,
        isComplete,
        missingPriceSymbols: portfolio.missingPriceSymbols,
        isCostBasisPartial: performance.isCostBasisPartial,
        missingCostBasisSymbols: performance.missingCostBasisSymbols,
        hasStalePrices: snapshot.hasStalePrices,
      };
    });
}

export function calculateStrategyAlignment(input: CalculateStrategyAlignmentInput): StrategyAlignment {
  const hasHoldings = input.totalHoldings > 0;
  const inRangeClasses = hasHoldings
    ? input.comparisons.filter((comparison) => comparison.status === "IN_RANGE").length
    : 0;
  const totalClasses = input.comparisons.length;
  const allocationPoints = Math.min(80, inRangeClasses * 20);
  const priceDataPoints = input.totalHoldings === 0
    ? 0
    : Math.round(20 * Math.min(1, Math.max(0, input.pricedHoldings / input.totalHoldings)));
  const score = !hasHoldings || totalClasses === 0 ? null : allocationPoints + priceDataPoints;

  return {
    score,
    allocationPoints,
    allocationMaxPoints: 80,
    priceDataPoints,
    priceDataMaxPoints: 20,
    inRangeClasses,
    totalClasses,
    pricedHoldings: input.pricedHoldings,
    totalHoldings: input.totalHoldings,
  };
}

export function calculateAssetClassAllocation(
  valuedHoldings: ValuedHolding[],
  totalValueInput?: Prisma.Decimal,
): AssetClassAllocation[] {
  const valuesByClass = new Map<AssetClass, Prisma.Decimal>();

  for (const assetClass of allocationClasses) {
    valuesByClass.set(assetClass, ZERO);
  }

  for (const holding of valuedHoldings) {
    const current = valuesByClass.get(holding.assetClass) ?? ZERO;
    valuesByClass.set(holding.assetClass, current.plus(decimal(holding.value)));
  }

  const totalValue =
    totalValueInput ??
    Array.from(valuesByClass.values()).reduce((total, value) => total.plus(value), ZERO);

  return allocationClasses.map((assetClass) => {
    const value = valuesByClass.get(assetClass) ?? ZERO;
    const percentage = isZero(totalValue) ? ZERO : value.div(totalValue).mul(ONE_HUNDRED);

    return {
      assetClass,
      value: toDecimalString(value),
      percentage: toDecimalString(percentage),
    };
  });
}

export function compareAllocationToStrategy(
  portfolio: PortfolioSnapshot,
  strategy: EngineStrategyAllocation[],
): AllocationComparison[] {
  validateStrategy(strategy);

  const currentByClass = new Map(portfolio.allocation.map((allocation) => [allocation.assetClass, allocation]));

  return strategy.map((strategyAllocation) => {
    const current = currentByClass.get(strategyAllocation.assetClass);
    const currentPercent = decimal(current?.percentage ?? 0);
    const targetPercent = decimal(strategyAllocation.targetPercent);
    const minPercent = decimal(strategyAllocation.minPercent);
    const maxPercent = decimal(strategyAllocation.maxPercent);
    const driftFromTarget = currentPercent.minus(targetPercent);
    const reasonCodes: ReasonCode[] = [];
    let status: AllocationComparison["status"] = "IN_RANGE";

    if (currentPercent.lessThan(minPercent)) {
      status = "UNDERWEIGHT";
      reasonCodes.push("ASSET_CLASS_UNDERWEIGHT", "BELOW_MIN_RANGE");
    }

    if (currentPercent.greaterThan(maxPercent)) {
      status = "OVERWEIGHT";
      reasonCodes.push("ASSET_CLASS_OVERWEIGHT", "ABOVE_MAX_RANGE");
    }

    return {
      assetClass: strategyAllocation.assetClass,
      currentPercent: toDecimalString(currentPercent),
      targetPercent: toDecimalString(targetPercent),
      minPercent: toDecimalString(minPercent),
      maxPercent: toDecimalString(maxPercent),
      driftFromTarget: toDecimalString(driftFromTarget),
      status,
      reasonCodes,
    };
  });
}

export function evaluateStrategyCompliance(
  portfolio: PortfolioSnapshot,
  strategy: EngineStrategyAllocation[],
): StrategyWarning[] {
  return compareAllocationToStrategy(portfolio, strategy)
    .filter((comparison) => comparison.status !== "IN_RANGE")
    .map((comparison) => ({
      code:
        comparison.status === "OVERWEIGHT"
          ? `${comparison.assetClass}_ABOVE_MAX`
          : `${comparison.assetClass}_BELOW_MIN`,
      assetClass: comparison.assetClass,
      currentPercent: comparison.currentPercent,
      limitPercent:
        comparison.status === "OVERWEIGHT" ? comparison.maxPercent : comparison.minPercent,
      reasonCodes: comparison.reasonCodes,
    }));
}

export function planContribution(input: PlanContributionInput): ContributionPlan {
  validateStrategy(input.strategy);
  validateStrategyAssetAllocations(input.strategy, input.assets);

  const contributionAmount = requireMoney(input.contributionAmount, "Contribution amount");

  if (contributionAmount.lessThan(ZERO)) {
    throw new Error("Contribution amount cannot be negative.");
  }

  if (contributionAmount.equals(ZERO)) {
    return {
      contributionAmount: toDecimalString(ZERO),
      allocations: [],
      assetRecommendations: [],
      before: input.portfolio,
      projectedAfter: input.portfolio,
      reasons: ["NO_CONTRIBUTION", "NO_SELL_REQUIRED"],
    };
  }

  const rawAllocations = calculateContributionAmounts(input.portfolio, input.strategy, contributionAmount);
  const roundedAllocations = roundContributionAllocations(rawAllocations, contributionAmount);
  const assetRecommendations = calculateAssetRecommendations({
    portfolio: input.portfolio,
    assets: input.assets,
    strategy: input.strategy,
    classAllocations: roundedAllocations,
    contributionAmount,
  });
  const projectedAfter = projectContribution(input.portfolio, roundedAllocations);

  return {
    contributionAmount: toDecimalString(contributionAmount),
    allocations: roundedAllocations,
    assetRecommendations,
    before: input.portfolio,
    projectedAfter,
    reasons: ["CONTRIBUTION_MOVES_TOWARD_TARGET", "NO_SELL_REQUIRED"],
  };
}

export function buildContributionProjection(input: PlanContributionInput): ContributionProjection {
  const plan = planContribution(input);
  return analyzeContributionProjection(plan, input.strategy, false);
}

export function projectCustomContribution(input: ProjectContributionInput): ContributionProjection {
  validateStrategy(input.strategy);
  validateStrategyAssetAllocations(input.strategy, input.assets);
  const contributionAmount = requireMoney(input.contributionAmount, "Contribution amount");

  if (contributionAmount.lessThan(ZERO)) {
    throw new Error("Contribution amount cannot be negative.");
  }

  const classes = new Set<AssetClass>();
  const strategyClasses = new Set(input.strategy.map((allocation) => allocation.assetClass));
  const allocations = input.allocations.map((allocation) => {
    if (!allocationClasses.includes(allocation.assetClass as (typeof allocationClasses)[number])) {
      throw new Error(`Unsupported contribution asset class: ${allocation.assetClass}.`);
    }
    if (!strategyClasses.has(allocation.assetClass)) {
      throw new Error(`${allocation.assetClass} is not enabled in the active strategy.`);
    }
    if (classes.has(allocation.assetClass)) {
      throw new Error(`Contribution must contain only one ${allocation.assetClass} allocation.`);
    }
    classes.add(allocation.assetClass);
    const amount = requireMoney(allocation.amount, `${allocation.assetClass} amount`);
    if (amount.lessThan(ZERO)) {
      throw new Error(`${allocation.assetClass} amount cannot be negative.`);
    }
    return { assetClass: allocation.assetClass, amount };
  });

  const missingStrategyClass = input.strategy.find((allocation) => !classes.has(allocation.assetClass));
  if (missingStrategyClass) {
    throw new Error(`Contribution must contain one ${missingStrategyClass.assetClass} allocation.`);
  }

  const allocationTotal = allocations.reduce((sum, allocation) => sum.plus(allocation.amount), ZERO);
  if (!allocationTotal.equals(contributionAmount)) {
    throw new Error("Custom allocation must equal the contribution amount exactly.");
  }

  const normalizedAllocations: ContributionAllocation[] = allocations
    .sort((left, right) => (allocationClassOrder.get(left.assetClass) ?? 0) - (allocationClassOrder.get(right.assetClass) ?? 0))
    .map((allocation) => ({
      assetClass: allocation.assetClass,
      amount: toDecimalString(allocation.amount),
      percentOfContribution: contributionAmount.equals(ZERO)
        ? toDecimalString(ZERO)
        : toDecimalString(allocation.amount.div(contributionAmount).mul(ONE_HUNDRED)),
    }));
  const plan: ContributionPlan = {
    contributionAmount: toDecimalString(contributionAmount),
    allocations: normalizedAllocations,
    assetRecommendations: calculateAssetRecommendations({
      portfolio: input.portfolio,
      assets: input.assets,
      strategy: input.strategy,
      classAllocations: normalizedAllocations,
      contributionAmount,
    }),
    before: input.portfolio,
    projectedAfter: projectContribution(input.portfolio, normalizedAllocations),
    reasons: contributionAmount.equals(ZERO)
      ? ["NO_CONTRIBUTION", "NO_SELL_REQUIRED"]
      : ["CONTRIBUTION_MOVES_TOWARD_TARGET", "NO_SELL_REQUIRED"],
  };

  return analyzeContributionProjection(plan, input.strategy, true);
}

export function simulateContribution(input: SimulateContributionInput) {
  const portfolio = calculatePortfolio(input);

  return planContribution({
    portfolio,
    assets: input.assets,
    strategy: input.strategy,
    contributionAmount: input.contributionAmount,
  });
}

export function simulateTransaction(input: SimulatedTransactionInput) {
  return calculatePortfolio({
    assets: input.assets,
    marketPrices: input.marketPrices,
    transactions: [...input.transactions, input.transaction],
  });
}

export function validateStrategy(strategy: EngineStrategyAllocation[]) {
  const parsed = strategy.map((allocation) => ({
    allocation,
    min: decimal(allocation.minPercent),
    target: decimal(allocation.targetPercent),
    max: decimal(allocation.maxPercent),
  }));
  const total = parsed.reduce((sum, item) => sum.plus(item.target), ZERO);

  if (!total.isFinite() || !total.equals(ONE_HUNDRED)) {
    throw new Error("Strategy target allocations must total 100%.");
  }

  const classCounts = new Map<AssetClass, number>();
  for (const { allocation, min, target, max } of parsed) {
    classCounts.set(allocation.assetClass, (classCounts.get(allocation.assetClass) ?? 0) + 1);

    if (![min, target, max].every((value) => value.isFinite())) {
      throw new Error(`${allocation.assetClass} percentages must be finite.`);
    }

    if (min.lessThan(ZERO) || max.greaterThan(ONE_HUNDRED)) {
      throw new Error(`${allocation.assetClass} percentages must be between 0 and 100.`);
    }

    if (min.greaterThan(target) || target.greaterThan(max)) {
      throw new Error(`${allocation.assetClass} must satisfy minPercent <= targetPercent <= maxPercent.`);
    }
  }

  if (strategy.length === 0) {
    throw new Error("Strategy must contain at least one allocation.");
  }

  for (const [assetClass, count] of classCounts) {
    if (!allocationClasses.includes(assetClass as (typeof allocationClasses)[number])) {
      throw new Error(`Unsupported strategy asset class: ${assetClass}.`);
    }
    if (count > 1) {
      throw new Error(`Strategy must contain only one ${assetClass} allocation.`);
    }
  }
}

export function validateStrategyAssetAllocations(strategy: EngineStrategyAllocation[], assets: EngineAsset[]) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  for (const allocation of strategy) {
    const assetAllocations = allocation.assetAllocations ?? [];
    if (assetAllocations.length === 0) {
      throw new Error(`${allocation.assetClass} must contain at least one asset target.`);
    }

    const assetIds = new Set<string>();
    let total = ZERO;
    for (const assetAllocation of assetAllocations) {
      if (assetIds.has(assetAllocation.assetId)) {
        throw new Error(`${allocation.assetClass} asset targets must not contain duplicate assets.`);
      }
      assetIds.add(assetAllocation.assetId);

      const target = decimal(assetAllocation.targetPercent);
      if (!target.isFinite()) {
        throw new Error(`${allocation.assetClass} asset target percentages must be finite.`);
      }
      if (target.lessThan(ZERO) || target.greaterThan(ONE_HUNDRED)) {
        throw new Error(`${allocation.assetClass} asset target percentages must be between 0 and 100.`);
      }

      const asset = assetsById.get(assetAllocation.assetId);
      if (!asset) {
        throw new Error(`${allocation.assetClass} asset target references an unknown asset.`);
      }
      if (asset.assetClass !== allocation.assetClass) {
        throw new Error(`${asset.symbol} must match parent ${allocation.assetClass} allocation.`);
      }

      total = total.plus(target);
    }

    if (!total.equals(ONE_HUNDRED)) {
      throw new Error(`${allocation.assetClass} asset targets must total exactly 100%.`);
    }
  }
}

function calculateContributionAmounts(
  portfolio: PortfolioSnapshot,
  strategy: EngineStrategyAllocation[],
  contributionAmount: Prisma.Decimal,
) {
  const beforeTotal = decimal(portfolio.totalValue);
  const afterTotal = beforeTotal.plus(contributionAmount);
  const currentValueByClass = new Map(
    portfolio.allocation.map((allocation) => [allocation.assetClass, decimal(allocation.value)]),
  );

  const deficits = strategy.map((allocation) => {
    const targetValueAfter = afterTotal.mul(decimal(allocation.targetPercent)).div(ONE_HUNDRED);
    const currentValue = currentValueByClass.get(allocation.assetClass) ?? ZERO;

    return {
      assetClass: allocation.assetClass,
      amount: maxDecimal(targetValueAfter.minus(currentValue), ZERO),
    };
  });
  const totalDeficit = deficits.reduce((sum, item) => sum.plus(item.amount), ZERO);
  const amounts = new Map<AssetClass, Prisma.Decimal>();

  if (totalDeficit.greaterThanOrEqualTo(contributionAmount)) {
    for (const deficit of deficits) {
      amounts.set(deficit.assetClass, deficit.amount.div(totalDeficit).mul(contributionAmount));
    }

    return amounts;
  }

  for (const deficit of deficits) {
    amounts.set(deficit.assetClass, deficit.amount);
  }

  const leftover = contributionAmount.minus(totalDeficit);

  if (leftover.equals(ZERO)) {
    return amounts;
  }

  const currentPercentByClass = new Map(
    portfolio.allocation.map((allocation) => [allocation.assetClass, decimal(allocation.percentage)]),
  );
  const eligible = strategy.filter((allocation) => {
    const currentPercent = currentPercentByClass.get(allocation.assetClass) ?? ZERO;
    const maxPercent = decimal(allocation.maxPercent);
    return currentPercent.lessThanOrEqualTo(maxPercent);
  });
  const weightedCandidates = eligible.length > 0 ? eligible : strategy;
  const totalWeight = weightedCandidates.reduce(
    (sum, allocation) => sum.plus(decimal(allocation.targetPercent)),
    ZERO,
  );

  for (const allocation of weightedCandidates) {
    const previous = amounts.get(allocation.assetClass) ?? ZERO;
    const additional = totalWeight.equals(ZERO)
      ? ZERO
      : leftover.mul(decimal(allocation.targetPercent)).div(totalWeight);
    amounts.set(allocation.assetClass, previous.plus(additional));
  }

  return amounts;
}

function roundContributionAllocations(
  rawAmounts: Map<AssetClass, Prisma.Decimal>,
  contributionAmount: Prisma.Decimal,
): ContributionAllocation[] {
  const contributionCents = contributionAmount.mul(100).toDecimalPlaces(0);
  const rows = Array.from(rawAmounts.entries()).map(([assetClass, amount]) => {
    const rawCents = amount.mul(100);
    const floorCents = rawCents.floor();

    return {
      assetClass,
      floorCents,
      fraction: rawCents.minus(floorCents),
    };
  });

  let distributedCents = rows.reduce((sum, row) => sum.plus(row.floorCents), ZERO);
  let remainingCents = contributionCents.minus(distributedCents);

  for (const row of rows.sort((left, right) => {
    const fractionCompare = decimal(right.fraction).cmp(decimal(left.fraction));
    return fractionCompare === 0 ? left.assetClass.localeCompare(right.assetClass) : fractionCompare;
  })) {
    if (remainingCents.lessThanOrEqualTo(ZERO)) {
      break;
    }

    row.floorCents = row.floorCents.plus(1);
    remainingCents = remainingCents.minus(1);
  }

  distributedCents = rows.reduce((sum, row) => sum.plus(row.floorCents), ZERO);

  if (!distributedCents.equals(contributionCents)) {
    const first = rows[0];

    if (first) {
      first.floorCents = first.floorCents.plus(contributionCents.minus(distributedCents));
    }
  }

  return rows
    .filter((row) => !row.floorCents.equals(ZERO))
    .sort(
      (left, right) =>
        (allocationClassOrder.get(left.assetClass) ?? Number.MAX_SAFE_INTEGER) -
        (allocationClassOrder.get(right.assetClass) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((row) => {
      const amount = decimal(row.floorCents).div(100);
      const percentOfContribution = contributionAmount.equals(ZERO)
        ? ZERO
        : amount.div(contributionAmount).mul(ONE_HUNDRED);

      return {
        assetClass: row.assetClass,
        amount: toDecimalString(amount),
        percentOfContribution: toDecimalString(percentOfContribution),
      };
    });
}

function calculateAssetRecommendations({
  portfolio,
  assets,
  strategy,
  classAllocations,
  contributionAmount,
}: {
  portfolio: PortfolioSnapshot;
  assets: EngineAsset[];
  strategy: EngineStrategyAllocation[];
  classAllocations: ContributionAllocation[];
  contributionAmount: Prisma.Decimal;
}): ContributionAssetRecommendation[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const currentValueByAsset = new Map<string, Prisma.Decimal>();
  for (const holding of portfolio.valuedHoldings) {
    currentValueByAsset.set(
      holding.assetId,
      (currentValueByAsset.get(holding.assetId) ?? ZERO).plus(decimal(holding.value)),
    );
  }

  const recommendations: ContributionAssetRecommendation[] = [];
  for (const classAllocation of classAllocations) {
    const strategyAllocation = strategy.find((allocation) => allocation.assetClass === classAllocation.assetClass);
    if (!strategyAllocation) continue;

    const classAmount = decimal(classAllocation.amount);
    if (classAmount.equals(ZERO)) continue;

    const assetTargets = strategyAllocation.assetAllocations ?? [];
    const currentClassValue = portfolio.valuedHoldings
      .filter((holding) => holding.assetClass === classAllocation.assetClass)
      .reduce((sum, holding) => sum.plus(decimal(holding.value)), ZERO);
    const projectedClassValue = currentClassValue.plus(classAmount);
    const rawAmounts = new Map<string, Prisma.Decimal>();

    const deficits = assetTargets.map((target) => {
      const currentValue = currentValueByAsset.get(target.assetId) ?? ZERO;
      const targetValueAfter = projectedClassValue.mul(decimal(target.targetPercent)).div(ONE_HUNDRED);
      return {
        assetId: target.assetId,
        amount: maxDecimal(targetValueAfter.minus(currentValue), ZERO),
      };
    });
    const totalDeficit = deficits.reduce((sum, item) => sum.plus(item.amount), ZERO);

    if (totalDeficit.greaterThanOrEqualTo(classAmount)) {
      for (const deficit of deficits) {
        rawAmounts.set(deficit.assetId, deficit.amount.div(totalDeficit).mul(classAmount));
      }
    } else {
      for (const deficit of deficits) {
        rawAmounts.set(deficit.assetId, deficit.amount);
      }

      const leftover = classAmount.minus(totalDeficit);
      const totalWeight = assetTargets.reduce((sum, target) => sum.plus(decimal(target.targetPercent)), ZERO);
      for (const target of assetTargets) {
        rawAmounts.set(
          target.assetId,
          (rawAmounts.get(target.assetId) ?? ZERO).plus(
            totalWeight.equals(ZERO) ? ZERO : leftover.mul(decimal(target.targetPercent)).div(totalWeight),
          ),
        );
      }
    }

    const rounded = roundAssetRecommendationAmounts(rawAmounts, classAmount);
    for (const target of assetTargets) {
      const amount = rounded.get(target.assetId) ?? ZERO;
      if (amount.equals(ZERO)) continue;

      const asset = assetsById.get(target.assetId);
      if (!asset) continue;

      const percentOfContribution = contributionAmount.equals(ZERO)
        ? ZERO
        : amount.div(contributionAmount).mul(ONE_HUNDRED);
      const targetPercentOfClass = decimal(target.targetPercent);
      const effectiveTargetPercent = decimal(strategyAllocation.targetPercent).mul(targetPercentOfClass).div(ONE_HUNDRED);

      recommendations.push({
        assetId: target.assetId,
        symbol: asset.symbol,
        name: asset.name ?? asset.symbol,
        assetClass: strategyAllocation.assetClass,
        amount: toDecimalString(amount),
        percentOfContribution: toDecimalString(percentOfContribution),
        targetPercentOfClass: toDecimalString(targetPercentOfClass),
        effectiveTargetPercent: toDecimalString(effectiveTargetPercent),
      });
    }
  }

  return recommendations.sort((left, right) => {
    const classCompare =
      (allocationClassOrder.get(left.assetClass) ?? Number.MAX_SAFE_INTEGER) -
      (allocationClassOrder.get(right.assetClass) ?? Number.MAX_SAFE_INTEGER);
    return classCompare === 0 ? left.symbol.localeCompare(right.symbol) : classCompare;
  });
}

function roundAssetRecommendationAmounts(rawAmounts: Map<string, Prisma.Decimal>, totalAmount: Prisma.Decimal) {
  const totalCents = totalAmount.mul(100).toDecimalPlaces(0);
  const rows = Array.from(rawAmounts.entries()).map(([assetId, amount]) => {
    const rawCents = amount.mul(100);
    const floorCents = rawCents.floor();
    return {
      assetId,
      floorCents,
      fraction: rawCents.minus(floorCents),
    };
  });

  let distributedCents = rows.reduce((sum, row) => sum.plus(row.floorCents), ZERO);
  let remainingCents = totalCents.minus(distributedCents);

  for (const row of rows.sort((left, right) => {
    const fractionCompare = decimal(right.fraction).cmp(decimal(left.fraction));
    return fractionCompare === 0 ? left.assetId.localeCompare(right.assetId) : fractionCompare;
  })) {
    if (remainingCents.lessThanOrEqualTo(ZERO)) break;
    row.floorCents = row.floorCents.plus(1);
    remainingCents = remainingCents.minus(1);
  }

  distributedCents = rows.reduce((sum, row) => sum.plus(row.floorCents), ZERO);
  const first = rows[0];
  if (first && !distributedCents.equals(totalCents)) {
    first.floorCents = first.floorCents.plus(totalCents.minus(distributedCents));
  }

  return new Map(rows.map((row) => [row.assetId, decimal(row.floorCents).div(100)]));
}

function projectContribution(portfolio: PortfolioSnapshot, allocations: ContributionAllocation[]): PortfolioSnapshot {
  const valueByClass = new Map(portfolio.allocation.map((allocation) => [allocation.assetClass, decimal(allocation.value)]));

  for (const allocation of allocations) {
    const current = valueByClass.get(allocation.assetClass) ?? ZERO;
    valueByClass.set(allocation.assetClass, current.plus(decimal(allocation.amount)));
  }

  const contributionTotal = allocations.reduce((total, allocation) => total.plus(decimal(allocation.amount)), ZERO);
  const totalValue = decimal(portfolio.totalValue).plus(contributionTotal);
  const allocation = allocationClasses.map((assetClass) => {
    const value = valueByClass.get(assetClass) ?? ZERO;
    const percentage = totalValue.equals(ZERO) ? ZERO : value.div(totalValue).mul(ONE_HUNDRED);

    return {
      assetClass,
      value: toDecimalString(value),
      percentage: toDecimalString(percentage),
    };
  });

  return {
    ...portfolio,
    totalValue: toDecimalString(totalValue),
    allocation,
  };
}

export function calculateHoldingCostBasis(input: CalculateHoldingCostBasisInput): HoldingCostBasis[] {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const pools = calculateCostPools(input, assetById);

  return input.portfolio.holdings.map((holding) => {
    const quantity = decimal(holding.quantity);
    const pool = pools.get(`${holding.accountId}:${holding.assetId}`);
    const unavailable = (reason: HoldingCostBasis["reason"]): HoldingCostBasis => ({
      accountId: holding.accountId,
      assetId: holding.assetId,
      status: "UNAVAILABLE",
      totalCost: null,
      averageAcquisitionPrice: null,
      reason,
    });

    if (!quantity.greaterThan(ZERO)) return unavailable("NON_POSITIVE_HOLDING");
    if (!pool || pool.reason) return unavailable(pool?.reason ?? "INCONSISTENT_TRANSACTION_HISTORY");
    if (!pool.quantity.equals(quantity)) return unavailable("INCONSISTENT_TRANSACTION_HISTORY");

    return {
      accountId: holding.accountId,
      assetId: holding.assetId,
      status: "AVAILABLE",
      totalCost: toDecimalString(pool.cost),
      averageAcquisitionPrice: toDecimalString(pool.cost.div(quantity)),
      reason: null,
    };
  });
}

function analyzeContributionProjection(
  plan: ContributionPlan,
  strategy: EngineStrategyAllocation[],
  isCustomized: boolean,
): ContributionProjection {
  const beforeComparison = compareAllocationToStrategy(plan.before, strategy);
  const afterComparison = compareAllocationToStrategy(plan.projectedAfter, strategy);
  const warnings = evaluateStrategyCompliance(plan.projectedAfter, strategy);
  const amountByClass = new Map(plan.allocations.map((allocation) => [allocation.assetClass, decimal(allocation.amount)]));
  const reasons: ContributionReason[] = plan.reasons.map((code) => ({ code }));

  for (const comparison of beforeComparison) {
    if (comparison.status === "UNDERWEIGHT") {
      reasons.push({ code: "ASSET_CLASS_UNDERWEIGHT", assetClass: comparison.assetClass });
    }
    if (comparison.status === "OVERWEIGHT" && (amountByClass.get(comparison.assetClass) ?? ZERO).equals(ZERO)) {
      reasons.push({ code: "OVERWEIGHT_CLASS_RECEIVES_NO_CONTRIBUTION", assetClass: comparison.assetClass });
    }
  }

  if (isCustomized) {
    for (const warning of warnings) {
      if (warning.code.endsWith("_ABOVE_MAX")) {
        reasons.push({ code: "CUSTOM_ALLOCATION_ABOVE_MAX", assetClass: warning.assetClass });
      }
    }
  }

  return { plan, beforeComparison, afterComparison, warnings, reasons, isCustomized };
}

function requireMoney(value: Parameters<typeof decimal>[0], label: string) {
  const amount = decimal(value);
  if (!amount.isFinite() || amount.decimalPlaces() > 2) {
    throw new Error(`${label} must be a finite amount with at most two decimal places.`);
  }
  return amount;
}

type CostPool = {
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
  reason: HoldingCostBasisReason | null;
};

type TransferLot = {
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
};

function calculateCostPools(
  input: CalculateHoldingCostBasisInput,
  assetById: Map<string, EngineAsset>,
) {
  const pools = new Map<string, CostPool>();
  const transferLotsByAsset = new Map<string, TransferLot[]>();
  const affectedAssetIds = new Set<string>();
  const transactions = input.transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((left, right) => {
      const timeCompare = transactionTime(left.transaction, left.index) - transactionTime(right.transaction, right.index);
      if (timeCompare !== 0) return timeCompare;
      const priorityCompare = transactionPriority(left.transaction.type) - transactionPriority(right.transaction.type);
      return priorityCompare === 0 ? left.index - right.index : priorityCompare;
    })
    .map(({ transaction }) => transaction);

  const poolFor = (accountId: string, assetId: string) => {
    const key = `${accountId}:${assetId}`;
    const pool = pools.get(key) ?? { quantity: ZERO, cost: ZERO, reason: null };
    pools.set(key, pool);
    return pool;
  };
  const markAssetUnavailable = (assetId: string, reason: HoldingCostBasisReason) => {
    affectedAssetIds.add(assetId);
    for (const [key, pool] of pools) {
      if (key.endsWith(`:${assetId}`)) pool.reason = reason;
    }
  };

  for (const transaction of transactions) {
    const asset = assetById.get(transaction.assetId);
    if (!asset) continue;
    affectedAssetIds.add(transaction.assetId);
    const pool = poolFor(transaction.accountId, transaction.assetId);
    const quantity = decimal(transaction.quantity);
    const implicitBaseCashPrice = asset.assetType === "FIAT" &&
      asset.currency?.toUpperCase() === input.baseCurrency.toUpperCase() &&
      (transaction.pricePerUnit === null || transaction.pricePerUnit === undefined);
    const pricePerUnit = implicitBaseCashPrice ? decimal(1) : transaction.pricePerUnit === null || transaction.pricePerUnit === undefined ? null : decimal(transaction.pricePerUnit);
    const transactionCost = pricePerUnit
      ? quantity.mul(pricePerUnit).plus(transaction.fee === null || transaction.fee === undefined ? ZERO : decimal(transaction.fee))
      : ZERO;

    if (transaction.type === TransactionType.INITIAL_BALANCE || transaction.type === TransactionType.BUY || transaction.type === TransactionType.DEPOSIT) {
      if (!pricePerUnit) {
        pool.reason = "MISSING_ACQUISITION_PRICE";
        continue;
      }
      if (transaction.currency?.toUpperCase() !== input.baseCurrency.toUpperCase()) {
        pool.reason = "UNSUPPORTED_TRANSACTION_CURRENCY";
        continue;
      }
      pool.quantity = pool.quantity.plus(quantity);
      pool.cost = pool.cost.plus(transactionCost);
      continue;
    }

    if (transaction.type === TransactionType.SELL || transaction.type === TransactionType.WITHDRAWAL || transaction.type === TransactionType.TRANSFER_OUT) {
      if (pool.quantity.equals(ZERO) || quantity.greaterThan(pool.quantity)) {
        pool.reason = "INCONSISTENT_TRANSACTION_HISTORY";
        continue;
      }
      const averageCost = pool.cost.div(pool.quantity);
      const movedCost = averageCost.mul(quantity);
      pool.quantity = pool.quantity.minus(quantity);
      pool.cost = pool.cost.minus(movedCost);

      if (transaction.type === TransactionType.TRANSFER_OUT) {
        const lots = transferLotsByAsset.get(transaction.assetId) ?? [];
        lots.push({ quantity, cost: movedCost });
        transferLotsByAsset.set(transaction.assetId, lots);
      }
      continue;
    }

    if (transaction.type === TransactionType.TRANSFER_IN) {
      const lots = transferLotsByAsset.get(transaction.assetId) ?? [];
      let remainingQuantity = quantity;
      let movedCost = ZERO;
      while (remainingQuantity.greaterThan(ZERO) && lots.length > 0) {
        const lot = lots[0];
        const consumedQuantity = remainingQuantity.lessThan(lot.quantity) ? remainingQuantity : lot.quantity;
        const consumedCost = lot.cost.mul(consumedQuantity).div(lot.quantity);
        remainingQuantity = remainingQuantity.minus(consumedQuantity);
        lot.quantity = lot.quantity.minus(consumedQuantity);
        lot.cost = lot.cost.minus(consumedCost);
        movedCost = movedCost.plus(consumedCost);
        if (lot.quantity.equals(ZERO)) lots.shift();
      }

      if (remainingQuantity.greaterThan(ZERO)) {
        pool.reason = "ACCOUNT_TRANSFER_COST_UNKNOWN";
        markAssetUnavailable(transaction.assetId, "ACCOUNT_TRANSFER_COST_UNKNOWN");
        continue;
      }

      pool.quantity = pool.quantity.plus(quantity);
      pool.cost = pool.cost.plus(movedCost);
    }
  }

  for (const [assetId, lots] of transferLotsByAsset) {
    if (lots.some((lot) => lot.quantity.greaterThan(ZERO))) {
      markAssetUnavailable(assetId, "ACCOUNT_TRANSFER_COST_UNKNOWN");
    }
  }

  for (const assetId of affectedAssetIds) {
    for (const [key, pool] of pools) {
      if (key.endsWith(`:${assetId}`) && pool.reason) {
        markAssetUnavailable(assetId, pool.reason);
      }
    }
  }

  return pools;
}

function transactionPriority(type: TransactionType) {
  if (
    type === TransactionType.INITIAL_BALANCE ||
    type === TransactionType.BUY ||
    type === TransactionType.DEPOSIT
  ) return 0;
  if (type === TransactionType.TRANSFER_OUT) return 1;
  if (type === TransactionType.TRANSFER_IN) return 2;
  return 3;
}

function calculateStrictUnrealizedPnl(
  input: CalculatePortfolioAnalyticsInput,
  assetById: Map<string, EngineAsset>,
  missingSymbols: Set<string>,
) {
  const holdingsByAsset = new Map<string, Prisma.Decimal>();
  for (const holding of input.portfolio.holdings) {
    const quantity = decimal(holding.quantity);
    if (quantity.lessThan(ZERO)) return null;
    holdingsByAsset.set(holding.assetId, (holdingsByAsset.get(holding.assetId) ?? ZERO).plus(quantity));
  }
  const activeAssets = [...holdingsByAsset.entries()].filter(([, quantity]) => quantity.greaterThan(ZERO));
  if (activeAssets.length === 0) return null;

  const currentValueByAsset = new Map<string, Prisma.Decimal>();
  for (const holding of input.portfolio.valuedHoldings) {
    currentValueByAsset.set(
      holding.assetId,
      (currentValueByAsset.get(holding.assetId) ?? ZERO).plus(decimal(holding.value)),
    );
  }

  const pools = calculateCostPools(input, assetById);
  let totalCost = ZERO;
  let totalCurrentValue = ZERO;
  for (const [assetId, currentQuantity] of activeAssets) {
    const asset = requireAsset(assetById, assetId);
    if (missingSymbols.has(asset.symbol)) return null;
    const currentValue = currentValueByAsset.get(assetId) ?? ZERO;
    totalCurrentValue = totalCurrentValue.plus(currentValue);
    const assetCost = [...pools.entries()]
      .filter(([key]) => key.endsWith(`:${assetId}`))
      .reduce((sum, [, pool]) => pool.reason ? sum : sum.plus(pool.cost), ZERO);
    const assetQuantity = [...pools.entries()]
      .filter(([key]) => key.endsWith(`:${assetId}`))
      .reduce((sum, [, pool]) => pool.reason ? sum : sum.plus(pool.quantity), ZERO);
    if (!assetQuantity.equals(currentQuantity)) return null;
    if ([...pools.entries()].some(([key, pool]) => key.endsWith(`:${assetId}`) && pool.reason)) return null;
    totalCost = totalCost.plus(assetCost);
  }

  return totalCurrentValue.minus(totalCost);
}

function calculatePerformanceSummary(
  input: CalculatePortfolioAnalyticsInput,
  assetById: Map<string, EngineAsset>,
) {
  const transactionsByAsset = new Map<string, EngineTransaction[]>();
  for (const transaction of input.transactions) {
    const transactions = transactionsByAsset.get(transaction.assetId) ?? [];
    transactions.push(transaction);
    transactionsByAsset.set(transaction.assetId, transactions);
  }

  const currentValueByAsset = new Map<string, Prisma.Decimal>();
  for (const holding of input.portfolio.valuedHoldings) {
    currentValueByAsset.set(
      holding.assetId,
      (currentValueByAsset.get(holding.assetId) ?? ZERO).plus(decimal(holding.value)),
    );
  }

  let netInvested = ZERO;
  let coveredPortfolioValue = ZERO;
  const missingCostBasisSymbols = new Set<string>();
  for (const [assetId, transactions] of transactionsByAsset) {
    const asset = requireAsset(assetById, assetId);
    const assetFlow = calculateAssetInvestmentFlow(transactions, asset, input.baseCurrency);
    if (assetFlow === null) {
      missingCostBasisSymbols.add(asset.symbol);
      continue;
    }
    netInvested = netInvested.plus(assetFlow);
    coveredPortfolioValue = coveredPortfolioValue.plus(currentValueByAsset.get(assetId) ?? ZERO);
  }

  const externalCashflows = calculateExternalCashflows(input.transactions, assetById, input.baseCurrency);
  const hasCompletePrices = input.portfolio.missingPriceSymbols.length === 0;
  const investmentGain = hasCompletePrices
    ? coveredPortfolioValue.minus(netInvested)
    : null;
  const simpleReturnPercent = investmentGain && netInvested.greaterThan(ZERO)
    ? investmentGain.div(netInvested).mul(ONE_HUNDRED)
    : null;

  return {
    netInvested: toDecimalString(netInvested),
    netContributed: toDecimalString(externalCashflows.netContributed),
    externalContributions: toDecimalString(externalCashflows.externalContributions),
    externalWithdrawals: toDecimalString(externalCashflows.externalWithdrawals),
    investmentGain: investmentGain ? toDecimalString(investmentGain) : null,
    simpleReturnPercent: simpleReturnPercent ? toDecimalString(simpleReturnPercent) : null,
    isCostBasisPartial: missingCostBasisSymbols.size > 0,
    missingCostBasisSymbols: [...missingCostBasisSymbols].sort(),
    isExternalCashflowPartial: externalCashflows.missingSymbols.size > 0,
    missingExternalCashflowSymbols: [...externalCashflows.missingSymbols].sort(),
  };
}

function calculateAssetInvestmentFlow(
  transactions: EngineTransaction[],
  asset: EngineAsset,
  baseCurrency: string,
) {
  let netInvested = ZERO;
  let transferQuantity = ZERO;

  for (const transaction of transactions) {
    const quantity = decimal(transaction.quantity);
    if (transaction.type === TransactionType.TRANSFER_IN) {
      transferQuantity = transferQuantity.plus(quantity);
      continue;
    }
    if (transaction.type === TransactionType.TRANSFER_OUT) {
      transferQuantity = transferQuantity.minus(quantity);
      continue;
    }

    const value = transactionCashValue(transaction, asset, baseCurrency);
    if (!value) return null;
    if (transaction.type === TransactionType.SELL || transaction.type === TransactionType.WITHDRAWAL) {
      netInvested = netInvested.minus(value.gross.minus(value.fee));
    } else {
      netInvested = netInvested.plus(value.gross.plus(value.fee));
    }
  }

  return transferQuantity.equals(ZERO) ? netInvested : null;
}

function calculateExternalCashflows(
  transactions: EngineTransaction[],
  assetById: Map<string, EngineAsset>,
  baseCurrency: string,
) {
  let externalContributions = ZERO;
  let externalWithdrawals = ZERO;
  const missingSymbols = new Set<string>();

  for (const transaction of transactions) {
    const isContribution = transaction.type === TransactionType.INITIAL_BALANCE || transaction.type === TransactionType.DEPOSIT;
    const isWithdrawal = transaction.type === TransactionType.WITHDRAWAL;
    if (!isContribution && !isWithdrawal) continue;

    const asset = assetById.get(transaction.assetId);
    if (!asset) continue;
    const value = transactionCashValue(transaction, asset, baseCurrency);
    if (!value) {
      missingSymbols.add(asset.symbol);
      continue;
    }
    const cashflowValue = value.gross.plus(value.fee);

    if (isContribution) {
      externalContributions = externalContributions.plus(cashflowValue);
    }
    if (isWithdrawal) {
      externalWithdrawals = externalWithdrawals.plus(value.gross.minus(value.fee));
    }
  }

  const netContributed = externalContributions.minus(externalWithdrawals);
  return { netContributed, externalContributions, externalWithdrawals, missingSymbols };
}

function transactionCashValue(
  transaction: EngineTransaction,
  asset: EngineAsset,
  baseCurrency: string,
) {
  if (transaction.currency?.toUpperCase() !== baseCurrency.toUpperCase()) return null;
  const price = transaction.pricePerUnit === null || transaction.pricePerUnit === undefined
    ? asset.assetType === "FIAT" && asset.currency?.toUpperCase() === baseCurrency.toUpperCase()
      ? decimal(1)
      : null
    : decimal(transaction.pricePerUnit);
  if (!price) return null;
  return {
    gross: decimal(transaction.quantity).mul(price),
    fee: transaction.fee === null || transaction.fee === undefined ? ZERO : decimal(transaction.fee),
  };
}

function transactionsThrough(transactions: EngineTransaction[], timestamp: number) {
  return transactions.filter((transaction) => transactionTimestamp(transaction) <= timestamp);
}

function transactionTimestamp(transaction: EngineTransaction) {
  if (!transaction.executedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(transaction.executedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function transactionTime(transaction: EngineTransaction, fallback: number) {
  if (!transaction.executedAt) return fallback;
  const timestamp = new Date(transaction.executedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function requireAsset(assetById: Map<string, EngineAsset>, assetId: string) {
  const asset = assetById.get(assetId);

  if (!asset) {
    throw new Error(`Asset ${assetId} was not provided to the portfolio engine.`);
  }

  return asset;
}
