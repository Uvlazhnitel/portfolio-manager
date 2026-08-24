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
  ContributionAllocation,
  ContributionPlan,
  EngineAsset,
  EngineStrategyAllocation,
  EngineTransaction,
  Holding,
  PlanContributionInput,
  PortfolioSnapshot,
  ReasonCode,
  SimulatedTransactionInput,
  SimulateContributionInput,
  StrategyWarning,
  ValuedHolding,
} from "@/features/portfolio-engine/types";

const allocationClasses = [AssetClass.ETF, AssetClass.CRYPTO, AssetClass.GOLD, AssetClass.CASH] as const;
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

export function calculateAssetClassAllocation(
  valuedHoldings: ValuedHolding[],
  totalValueInput?: Prisma.Decimal,
): AssetClassAllocation[] {
  const valuesByClass = new Map<AssetClass, Prisma.Decimal>();

  for (const assetClass of allocationClasses) {
    valuesByClass.set(assetClass, ZERO);
  }

  for (const holding of valuedHoldings) {
    if (!allocationClasses.includes(holding.assetClass as (typeof allocationClasses)[number])) {
      continue;
    }

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

  const contributionAmount = decimal(input.contributionAmount);

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
  const total = strategy.reduce((sum, allocation) => sum.plus(decimal(allocation.targetPercent)), ZERO);

  if (!total.equals(ONE_HUNDRED)) {
    throw new Error("Strategy target allocations must total 100%.");
  }

  for (const allocation of strategy) {
    const min = decimal(allocation.minPercent);
    const target = decimal(allocation.targetPercent);
    const max = decimal(allocation.maxPercent);

    if (min.greaterThan(target) || target.greaterThan(max)) {
      throw new Error(`${allocation.assetClass} must satisfy minPercent <= targetPercent <= maxPercent.`);
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
  const contributionCents = contributionAmount.mul(100).toDecimalPlaces(0).toNumber();
  const rows = Array.from(rawAmounts.entries()).map(([assetClass, amount]) => {
    const rawCents = amount.mul(100);
    const floorCents = rawCents.floor().toNumber();

    return {
      assetClass,
      floorCents,
      fraction: rawCents.minus(floorCents),
    };
  });

  let distributedCents = rows.reduce((sum, row) => sum + row.floorCents, 0);
  let remainingCents = contributionCents - distributedCents;

  for (const row of rows.sort((left, right) => {
    const fractionCompare = decimal(right.fraction).cmp(decimal(left.fraction));
    return fractionCompare === 0 ? left.assetClass.localeCompare(right.assetClass) : fractionCompare;
  })) {
    if (remainingCents <= 0) {
      break;
    }

    row.floorCents += 1;
    remainingCents -= 1;
  }

  distributedCents = rows.reduce((sum, row) => sum + row.floorCents, 0);

  if (distributedCents !== contributionCents) {
    const first = rows[0];

    if (first) {
      first.floorCents += contributionCents - distributedCents;
    }
  }

  return rows
    .filter((row) => row.floorCents !== 0)
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

  const totalValue = Array.from(valueByClass.values()).reduce((total, value) => total.plus(value), ZERO);
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

function requireAsset(assetById: Map<string, EngineAsset>, assetId: string) {
  const asset = assetById.get(assetId);

  if (!asset) {
    throw new Error(`Asset ${assetId} was not provided to the portfolio engine.`);
  }

  return asset;
}
