import { AssetClass } from "@prisma/client";
import { decimal, ONE_HUNDRED, toDecimalString, ZERO } from "@/features/portfolio-engine/decimal";
import {
  calculatePortfolio,
  calculatePortfolioAnalytics,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
} from "@/features/portfolio-engine/engine";
import type {
  AllocationComparison,
  CalculateDailyBriefInput,
  DailyBriefAllocationChange,
  DailyBriefContributor,
  DailyBriefReasonCode,
  DailyBriefResult,
  DailyBriefRiskSignal,
  EngineTransaction,
  PortfolioSnapshot,
  StrategyWarning,
} from "@/features/portfolio-engine/types";

export function calculateDailyBrief(input: CalculateDailyBriefInput): DailyBriefResult {
  const asOf = new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime())) throw new Error("Daily Brief requires a valid as-of date.");

  const currentDate = asOf.toISOString().slice(0, 10);
  const previousObservation = [...input.history]
    .filter((snapshot) => snapshot.date < currentDate)
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
  const currentTransactions = transactionsThrough(input.transactions, asOf.getTime());
  const currentPortfolio = calculatePortfolio({
    assets: input.assets,
    transactions: currentTransactions,
    marketPrices: input.currentMarketPrices,
  });
  const currentAnalytics = calculatePortfolioAnalytics({
    portfolio: currentPortfolio,
    assets: input.assets,
    transactions: currentTransactions,
    baseCurrency: input.baseCurrency,
  });

  const previousTransactions = previousObservation
    ? transactionsThrough(input.transactions, Date.parse(`${previousObservation.date}T23:59:59.999Z`))
    : [];
  const previousPortfolio = previousObservation
    ? calculatePortfolio({
      assets: input.assets,
      transactions: previousTransactions,
      marketPrices: previousObservation.marketPrices,
    })
    : null;
  const previousAnalytics = previousPortfolio
    ? calculatePortfolioAnalytics({
      portfolio: previousPortfolio,
      assets: input.assets,
      transactions: previousTransactions,
      baseCurrency: input.baseCurrency,
    })
    : null;

  const missingPriceSymbols = [...new Set([
    ...currentPortfolio.missingPriceSymbols,
    ...(previousPortfolio?.missingPriceSymbols ?? []),
  ])].sort();
  const isStale = input.currentHasStalePrices || Boolean(previousObservation?.hasStalePrices);
  const unavailableReason = determineUnavailableReason({
    previousObservationExists: Boolean(previousObservation),
    currentPortfolio,
    previousPortfolio,
    currentExternalContributions: currentAnalytics.externalContributions,
    currentExternalWithdrawals: currentAnalytics.externalWithdrawals,
    previousExternalContributions: previousAnalytics?.externalContributions ?? null,
    previousExternalWithdrawals: previousAnalytics?.externalWithdrawals ?? null,
  });
  const performance = unavailableReason || !previousPortfolio || !previousAnalytics
    ? null
    : calculateDailyPerformance({
      currentPortfolio,
      previousPortfolio,
      currentContributions: currentAnalytics.externalContributions!,
      currentWithdrawals: currentAnalytics.externalWithdrawals!,
      previousContributions: previousAnalytics.externalContributions!,
      previousWithdrawals: previousAnalytics.externalWithdrawals!,
    });

  const canCompareStrategy = Boolean(
    input.strategy && previousPortfolio &&
    currentPortfolio.missingPriceSymbols.length === 0 &&
    previousPortfolio.missingPriceSymbols.length === 0,
  );
  const currentComparisons = canCompareStrategy
    ? compareAllocationToStrategy(currentPortfolio, input.strategy!)
    : [];
  const previousComparisons = canCompareStrategy
    ? compareAllocationToStrategy(previousPortfolio!, input.strategy!)
    : [];
  const currentViolations = canCompareStrategy
    ? evaluateStrategyCompliance(currentPortfolio, input.strategy!)
    : [];
  const previousViolations = canCompareStrategy
    ? evaluateStrategyCompliance(previousPortfolio!, input.strategy!)
    : [];
  const previousViolationByCode = new Map(previousViolations.map((warning) => [warning.code, warning]));
  const currentViolationByCode = new Map(currentViolations.map((warning) => [warning.code, warning]));
  const newViolations = currentViolations.filter((warning) => !previousViolationByCode.has(warning.code));
  const resolvedViolations = previousViolations.filter((warning) => !currentViolationByCode.has(warning.code));
  const allocationChanges = buildAllocationChanges(currentComparisons, previousComparisons);
  const status = determineStatus({
    input,
    unavailableReason,
    isStale,
    newViolations,
    resolvedViolations,
    allocationChanges,
  });

  return {
    ...status,
    currentDate,
    previousDate: previousObservation?.date ?? null,
    currentValue: currentPortfolio.missingPriceSymbols.length === 0 ? currentPortfolio.totalValue : null,
    previousValue: previousPortfolio && previousPortfolio.missingPriceSymbols.length === 0
      ? previousPortfolio.totalValue
      : null,
    portfolioValueChange: performance?.portfolioValueChange ?? null,
    dailyGain: performance?.dailyGain ?? null,
    dailyReturnPercent: performance?.dailyReturnPercent ?? null,
    externalContributions: performance?.externalContributions ?? null,
    externalWithdrawals: performance?.externalWithdrawals ?? null,
    unavailableReason,
    isStale,
    missingPriceSymbols,
    positiveContributors: performance && previousObservation && previousPortfolio
      ? buildContributors(input, previousPortfolio, previousObservation.marketPrices).positive
      : [],
    negativeContributors: performance && previousObservation && previousPortfolio
      ? buildContributors(input, previousPortfolio, previousObservation.marketPrices).negative
      : [],
    allocationChanges,
    newViolations,
    resolvedViolations,
    currentViolations,
    riskSignals: buildRiskSignals(input, currentPortfolio, currentComparisons, currentAnalytics.accounts),
  };
}

function determineUnavailableReason(input: {
  previousObservationExists: boolean;
  currentPortfolio: PortfolioSnapshot;
  previousPortfolio: PortfolioSnapshot | null;
  currentExternalContributions: string | null;
  currentExternalWithdrawals: string | null;
  previousExternalContributions: string | null;
  previousExternalWithdrawals: string | null;
}) {
  if (!input.previousObservationExists) return "NO_PREVIOUS_OBSERVATION" as const;
  if (!input.previousPortfolio || input.previousPortfolio.missingPriceSymbols.length > 0) {
    return "PREVIOUS_VALUATION_INCOMPLETE" as const;
  }
  if (input.currentPortfolio.missingPriceSymbols.length > 0) return "CURRENT_VALUATION_INCOMPLETE" as const;
  if (
    input.currentExternalContributions === null || input.currentExternalWithdrawals === null ||
    input.previousExternalContributions === null || input.previousExternalWithdrawals === null
  ) return "INCOMPLETE_EXTERNAL_CASHFLOWS" as const;
  if (decimal(input.previousPortfolio.totalValue).lessThanOrEqualTo(ZERO)) return "INVALID_PREVIOUS_VALUE" as const;
  return null;
}

function calculateDailyPerformance(input: {
  currentPortfolio: PortfolioSnapshot;
  previousPortfolio: PortfolioSnapshot;
  currentContributions: string;
  currentWithdrawals: string;
  previousContributions: string;
  previousWithdrawals: string;
}) {
  const currentValue = decimal(input.currentPortfolio.totalValue);
  const previousValue = decimal(input.previousPortfolio.totalValue);
  const contributions = decimal(input.currentContributions).minus(input.previousContributions);
  const withdrawals = decimal(input.currentWithdrawals).minus(input.previousWithdrawals);
  const valueChange = currentValue.minus(previousValue);
  const gain = valueChange.minus(contributions).plus(withdrawals);
  return {
    portfolioValueChange: toDecimalString(valueChange),
    dailyGain: toDecimalString(gain),
    dailyReturnPercent: toDecimalString(gain.div(previousValue).mul(ONE_HUNDRED)),
    externalContributions: toDecimalString(contributions),
    externalWithdrawals: toDecimalString(withdrawals),
  };
}

function buildContributors(
  input: CalculateDailyBriefInput,
  previousPortfolio: PortfolioSnapshot,
  previousPrices: CalculateDailyBriefInput["currentMarketPrices"],
) {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const quantities = new Map<string, ReturnType<typeof decimal>>();
  for (const holding of previousPortfolio.holdings) {
    quantities.set(holding.assetId, (quantities.get(holding.assetId) ?? ZERO).plus(holding.quantity));
  }
  const contributors: DailyBriefContributor[] = [];
  for (const [assetId, quantity] of quantities) {
    const asset = assetById.get(assetId);
    if (!asset) continue;
    const previousPriceValue = previousPrices[asset.symbol];
    const currentPriceValue = input.currentMarketPrices[asset.symbol];
    if (previousPriceValue === undefined || currentPriceValue === undefined) continue;
    const previousPrice = decimal(previousPriceValue);
    if (previousPrice.lessThanOrEqualTo(ZERO)) continue;
    const currentPrice = decimal(currentPriceValue);
    const contribution = quantity.mul(currentPrice.minus(previousPrice));
    if (contribution.equals(ZERO)) continue;
    contributors.push({
      assetId,
      symbol: asset.symbol,
      contribution: toDecimalString(contribution),
      priceChangePercent: toDecimalString(currentPrice.minus(previousPrice).div(previousPrice).mul(ONE_HUNDRED)),
    });
  }
  return {
    positive: contributors.filter((item) => decimal(item.contribution).greaterThan(ZERO))
      .sort((left, right) => decimal(right.contribution).comparedTo(left.contribution)).slice(0, 3),
    negative: contributors.filter((item) => decimal(item.contribution).lessThan(ZERO))
      .sort((left, right) => decimal(left.contribution).comparedTo(right.contribution)).slice(0, 3),
  };
}

function buildAllocationChanges(current: AllocationComparison[], previous: AllocationComparison[]) {
  const previousByClass = new Map(previous.map((comparison) => [comparison.assetClass, comparison]));
  return current.map((comparison): DailyBriefAllocationChange => {
    const prior = previousByClass.get(comparison.assetClass)!;
    return {
      ...comparison,
      previousPercent: prior.currentPercent,
      previousDriftFromTarget: prior.driftFromTarget,
      driftChange: toDecimalString(decimal(comparison.driftFromTarget).minus(prior.driftFromTarget)),
      previousStatus: prior.status,
    };
  }).sort((left, right) => decimal(right.driftChange).abs().comparedTo(decimal(left.driftChange).abs()));
}

function determineStatus(input: {
  input: CalculateDailyBriefInput;
  unavailableReason: DailyBriefResult["unavailableReason"];
  isStale: boolean;
  newViolations: StrategyWarning[];
  resolvedViolations: StrategyWarning[];
  allocationChanges: DailyBriefAllocationChange[];
}): Pick<DailyBriefResult, "status" | "summary" | "reasonCodes"> {
  const threshold = decimal(input.input.rules.minimumRebalanceDrift).abs();
  const comparisonByClass = new Map(input.allocationChanges.map((comparison) => [comparison.assetClass, comparison]));
  const actionableNew = input.newViolations.filter((warning) => {
    const comparison = comparisonByClass.get(warning.assetClass);
    return comparison && decimal(comparison.driftFromTarget).abs().greaterThanOrEqualTo(threshold);
  });
  if (actionableNew.length > 0 && input.input.rules.challengeStrategyViolations) {
    const reasonCodes: DailyBriefReasonCode[] = ["NEW_STRATEGY_VIOLATION", "MINIMUM_REBALANCE_DRIFT_EXCEEDED"];
    if (input.input.rules.preferContributionsOverSelling) reasonCodes.push("CONTRIBUTION_FIRST_REVIEW");
    return {
      status: "ACTION",
      summary: input.input.rules.preferContributionsOverSelling
        ? "A new allocation violation crossed the review threshold. Review the next contribution before changing holdings."
        : "A new allocation violation crossed the configured review threshold.",
      reasonCodes,
    };
  }
  if (input.newViolations.length > 0) {
    return {
      status: "MONITOR",
      summary: "A new allocation violation is visible, but it does not require an immediate portfolio change.",
      reasonCodes: [
        "NEW_STRATEGY_VIOLATION",
        ...(actionableNew.length === 0
          ? ["BELOW_MINIMUM_REBALANCE_DRIFT" as const]
          : ["STRATEGY_CHALLENGE_DISABLED" as const]),
      ],
    };
  }
  const worsened = input.allocationChanges.some((comparison) =>
    comparison.status !== "IN_RANGE" &&
    decimal(comparison.driftFromTarget).abs().minus(decimal(comparison.previousDriftFromTarget).abs()).greaterThanOrEqualTo(threshold),
  );
  if (worsened) {
    return { status: "MONITOR", summary: "An existing allocation violation moved farther from target.", reasonCodes: ["EXISTING_VIOLATION_WORSENED"] };
  }
  if (input.isStale) {
    return { status: "MONITOR", summary: "Portfolio facts are available, but at least one daily price is stale.", reasonCodes: ["STALE_PRICE_DATA"] };
  }
  if (input.unavailableReason) {
    return {
      status: input.input.rules.preferNoActionWhenEvidenceWeak ? "NO_ACTION" : "MONITOR",
      summary: "There is not enough complete daily data to make a reliable comparison.",
      reasonCodes: ["INSUFFICIENT_DAILY_DATA"],
    };
  }
  if (input.resolvedViolations.length > 0) {
    return { status: "NO_ACTION", summary: "A previous strategy violation has cleared; no rebalance action is required.", reasonCodes: ["STRATEGY_VIOLATION_RESOLVED"] };
  }
  return { status: "NO_ACTION", summary: "No meaningful strategy or risk change was detected.", reasonCodes: ["NO_MEANINGFUL_STRATEGY_CHANGE"] };
}

function buildRiskSignals(
  input: CalculateDailyBriefInput,
  portfolio: PortfolioSnapshot,
  comparisons: AllocationComparison[],
  accounts: Array<{ accountId: string; value: string; isPartial: boolean }>,
): DailyBriefRiskSignal[] {
  const totalValue = decimal(portfolio.totalValue);
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const valueByAsset = new Map<string, ReturnType<typeof decimal>>();
  for (const holding of portfolio.valuedHoldings) {
    valueByAsset.set(holding.assetId, (valueByAsset.get(holding.assetId) ?? ZERO).plus(holding.value));
  }
  const largestAsset = [...valueByAsset.entries()].sort((left, right) => right[1].comparedTo(left[1]))[0];
  const largestAccount = [...accounts].sort((left, right) => decimal(right.value).comparedTo(left.value))[0];
  const crypto = portfolio.allocation.find((allocation) => allocation.assetClass === AssetClass.CRYPTO);
  const cryptoComparison = comparisons.find((comparison) => comparison.assetClass === AssetClass.CRYPTO);
  const result: DailyBriefRiskSignal[] = [];
  if (largestAsset && totalValue.greaterThan(ZERO)) {
    const asset = assetById.get(largestAsset[0]);
    result.push({ code: "LARGEST_ASSET", label: "Largest asset", value: `${toDecimalString(largestAsset[1].div(totalValue).mul(ONE_HUNDRED))}%`, detail: asset?.symbol ?? largestAsset[0], tone: "NEUTRAL" });
  }
  if (largestAccount && totalValue.greaterThan(ZERO)) {
    const account = accountById.get(largestAccount.accountId);
    result.push({ code: "LARGEST_CUSTODY_ACCOUNT", label: "Largest custody", value: `${toDecimalString(decimal(largestAccount.value).div(totalValue).mul(ONE_HUNDRED))}%`, detail: account ? `${account.name} · ${account.type}` : largestAccount.accountId, tone: "NEUTRAL" });
  }
  if (crypto) {
    result.push({ code: "CRYPTO_ALLOCATION", label: "Crypto allocation", value: `${crypto.percentage}%`, detail: cryptoComparison ? cryptoComparison.status.replace("_", " ").toLowerCase() : "No strategy comparison", tone: cryptoComparison && cryptoComparison.status !== "IN_RANGE" ? "WARNING" : "NEUTRAL" });
  }
  return result;
}

function transactionsThrough(transactions: EngineTransaction[], timestamp: number) {
  return transactions.filter((transaction) => {
    if (!transaction.executedAt) return true;
    const executedAt = new Date(transaction.executedAt).getTime();
    return Number.isFinite(executedAt) && executedAt <= timestamp;
  });
}
