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
  CalculateStrategyAlignmentInput,
  ContributionAllocation,
  ContributionPlan,
  ContributionProjection,
  ContributionReason,
  EngineAsset,
  EngineStrategyAllocation,
  EngineTransaction,
  Holding,
  HoldingCostBasis,
  PlanContributionInput,
  ProjectContributionInput,
  PortfolioSnapshot,
  PortfolioAnalytics,
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

  return {
    totalUnrealizedPnl: totalUnrealizedPnl ? toDecimalString(totalUnrealizedPnl) : null,
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

  const contributionAmount = requireMoney(input.contributionAmount, "Contribution amount");

  if (contributionAmount.lessThan(ZERO)) {
    throw new Error("Contribution amount cannot be negative.");
  }

  if (contributionAmount.equals(ZERO)) {
    return {
      contributionAmount: toDecimalString(ZERO),
      allocations: [],
      before: input.portfolio,
      projectedAfter: input.portfolio,
      reasons: ["NO_CONTRIBUTION", "NO_SELL_REQUIRED"],
    };
  }

  const rawAllocations = calculateContributionAmounts(input.portfolio, input.strategy, contributionAmount);
  const roundedAllocations = roundContributionAllocations(rawAllocations, contributionAmount);
  const projectedAfter = projectContribution(input.portfolio, roundedAllocations);

  return {
    contributionAmount: toDecimalString(contributionAmount),
    allocations: roundedAllocations,
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
  const transactionsByHolding = new Map<string, EngineTransaction[]>();

  for (const transaction of input.transactions) {
    const key = `${transaction.accountId}:${transaction.assetId}`;
    const current = transactionsByHolding.get(key) ?? [];
    current.push(transaction);
    transactionsByHolding.set(key, current);
  }

  return input.portfolio.holdings.map((holding) => {
    const asset = requireAsset(assetById, holding.assetId);
    const quantity = decimal(holding.quantity);
    const unavailable = (reason: HoldingCostBasis["reason"]): HoldingCostBasis => ({
      accountId: holding.accountId,
      assetId: holding.assetId,
      status: "UNAVAILABLE",
      totalCost: null,
      averageAcquisitionPrice: null,
      reason,
    });

    if (!quantity.greaterThan(ZERO)) return unavailable("NON_POSITIVE_HOLDING");

    if (asset.assetType === "FIAT" && asset.currency?.toUpperCase() === input.baseCurrency.toUpperCase()) {
      return {
        accountId: holding.accountId,
        assetId: holding.assetId,
        status: "AVAILABLE",
        totalCost: toDecimalString(quantity),
        averageAcquisitionPrice: toDecimalString(decimal(1)),
        reason: null,
      };
    }

    const transactions = [...(transactionsByHolding.get(`${holding.accountId}:${holding.assetId}`) ?? [])]
      .map((transaction, index) => ({ transaction, index }))
      .sort((left, right) => transactionTime(left.transaction, left.index) - transactionTime(right.transaction, right.index))
      .map(({ transaction }) => transaction);
    let trackedQuantity = ZERO;
    let trackedCost = ZERO;

    for (const transaction of transactions) {
      const transactionQuantity = decimal(transaction.quantity);
      if (transaction.type === TransactionType.TRANSFER_IN || transaction.type === TransactionType.TRANSFER_OUT) {
        return unavailable("ACCOUNT_TRANSFER_COST_UNKNOWN");
      }
      if (transaction.type === TransactionType.DEPOSIT || transaction.type === TransactionType.WITHDRAWAL) {
        return unavailable("UNSUPPORTED_QUANTITY_MOVEMENT");
      }
      if (transaction.type === TransactionType.INITIAL_BALANCE || transaction.type === TransactionType.BUY) {
        if (transaction.pricePerUnit === null || transaction.pricePerUnit === undefined) {
          return unavailable("MISSING_ACQUISITION_PRICE");
        }
        if (transaction.currency?.toUpperCase() !== input.baseCurrency.toUpperCase()) {
          return unavailable("UNSUPPORTED_TRANSACTION_CURRENCY");
        }
        trackedQuantity = trackedQuantity.plus(transactionQuantity);
        trackedCost = trackedCost
          .plus(transactionQuantity.mul(decimal(transaction.pricePerUnit)))
          .plus(transaction.fee === null || transaction.fee === undefined ? ZERO : decimal(transaction.fee));
      }
      if (transaction.type === TransactionType.SELL) {
        if (trackedQuantity.equals(ZERO) || transactionQuantity.greaterThan(trackedQuantity)) {
          return unavailable("INCONSISTENT_TRANSACTION_HISTORY");
        }
        const averageCost = trackedCost.div(trackedQuantity);
        trackedQuantity = trackedQuantity.minus(transactionQuantity);
        trackedCost = trackedCost.minus(averageCost.mul(transactionQuantity));
      }
    }

    if (!trackedQuantity.equals(quantity)) return unavailable("INCONSISTENT_TRANSACTION_HISTORY");

    return {
      accountId: holding.accountId,
      assetId: holding.assetId,
      status: "AVAILABLE",
      totalCost: toDecimalString(trackedCost),
      averageAcquisitionPrice: toDecimalString(trackedCost.div(quantity)),
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

  let totalCost = ZERO;
  let totalCurrentValue = ZERO;
  for (const [assetId, currentQuantity] of activeAssets) {
    const asset = requireAsset(assetById, assetId);
    if (missingSymbols.has(asset.symbol)) return null;
    const currentValue = currentValueByAsset.get(assetId) ?? ZERO;
    totalCurrentValue = totalCurrentValue.plus(currentValue);

    if (asset.assetType === "FIAT" && asset.currency?.toUpperCase() === input.baseCurrency.toUpperCase()) {
      totalCost = totalCost.plus(currentValue);
      continue;
    }

    const assetTransactions = input.transactions
      .filter((transaction) => transaction.assetId === assetId)
      .map((transaction, index) => ({ transaction, index }))
      .sort((left, right) => transactionTime(left.transaction, left.index) - transactionTime(right.transaction, right.index))
      .map(({ transaction }) => transaction);
    const transferIn = sumTransactionQuantity(assetTransactions, TransactionType.TRANSFER_IN);
    const transferOut = sumTransactionQuantity(assetTransactions, TransactionType.TRANSFER_OUT);
    if (!transferIn.equals(transferOut)) return null;

    let trackedQuantity = ZERO;
    let trackedCost = ZERO;
    for (const transaction of assetTransactions) {
      const quantity = decimal(transaction.quantity);
      if (transaction.type === TransactionType.TRANSFER_IN || transaction.type === TransactionType.TRANSFER_OUT) {
        continue;
      }
      if (transaction.type === TransactionType.DEPOSIT || transaction.type === TransactionType.WITHDRAWAL) {
        return null;
      }
      if (transaction.type === TransactionType.INITIAL_BALANCE || transaction.type === TransactionType.BUY) {
        if (transaction.pricePerUnit === null || transaction.pricePerUnit === undefined) return null;
        if (transaction.currency?.toUpperCase() !== input.baseCurrency.toUpperCase()) return null;
        trackedQuantity = trackedQuantity.plus(quantity);
        trackedCost = trackedCost
          .plus(quantity.mul(decimal(transaction.pricePerUnit)))
          .plus(transaction.fee === null || transaction.fee === undefined ? ZERO : decimal(transaction.fee));
      }
      if (transaction.type === TransactionType.SELL) {
        if (quantity.greaterThan(trackedQuantity) || trackedQuantity.equals(ZERO)) return null;
        const averageCost = trackedCost.div(trackedQuantity);
        trackedQuantity = trackedQuantity.minus(quantity);
        trackedCost = trackedCost.minus(averageCost.mul(quantity));
      }
    }
    if (!trackedQuantity.equals(currentQuantity)) return null;
    totalCost = totalCost.plus(trackedCost);
  }

  return totalCurrentValue.minus(totalCost);
}

function sumTransactionQuantity(transactions: EngineTransaction[], type: TransactionType) {
  return transactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum.plus(decimal(transaction.quantity)), ZERO);
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
