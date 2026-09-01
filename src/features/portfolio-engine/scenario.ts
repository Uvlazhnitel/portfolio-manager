import { TransactionType, type Prisma } from "@prisma/client";
import { decimal, toDecimalString, toQuantityString, ZERO } from "@/features/portfolio-engine/decimal";
import {
  calculatePortfolio,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  requireCompletePortfolioValuation,
} from "@/features/portfolio-engine/engine";
import { calculatePortfolioRisk } from "@/features/portfolio-engine/risk";
import type {
  CalculatePortfolioScenarioInput,
  PortfolioScenarioResult,
  PortfolioScenarioWarning,
} from "@/features/portfolio-engine/types";

export function calculatePortfolioScenario(input: CalculatePortfolioScenarioInput): PortfolioScenarioResult {
  if (input.kind === "TRADE") return calculateTradeScenario(input);

  const amount = requirePositiveMoney(input.amount, "Scenario amount");
  const asset = requireScenarioAsset(input, input.assetId, "Selected asset");
  requireScenarioAccount(input, input.accountId, "Selected account");
  const price = requireMarketPrice(input, asset.id, "Current price");

  const current = calculatePortfolio(input);
  requireCompletePortfolioValuation(current);
  const quantity = amount.div(price);
  if (input.kind === "SELL") validateAccountSell(current, input.accountId, input.assetId, quantity, asset.symbol);

  const currentRisk = riskFor(current, input);
  const currentWarnings = warningsFor(current, currentRisk, input);
  const projected = project(input, quantity, price);
  const projectedRisk = riskFor(projected, input);
  const projectedWarnings = warningsFor(projected, projectedRisk, input);
  const currentKeys = new Set(currentWarnings.map(warningKey));
  const projectedKeys = new Set(projectedWarnings.map(warningKey));
  const newWarnings = projectedWarnings.filter((warning) => !currentKeys.has(warningKey(warning)));
  const resolvedWarnings = currentWarnings.filter((warning) => !projectedKeys.has(warningKey(warning)));
  const isPartial = current.missingPriceSymbols.length > 0 || projected.missingPriceSymbols.length > 0;
  const normalizedKind = input.kind === "BUY" ? "EXTERNAL_BUY" : input.kind;
  const searchedCompliant = normalizedKind !== "SELL" && newWarnings.length > 0 && !isPartial
    ? findMaximumCompliantAmount(input, amount, price, currentKeys)
    : null;
  const compliant = searchedCompliant
    ? capByStrategyClassMax(input, current, asset.assetClass, searchedCompliant)
    : null;
  const maximumCompliantAmount = compliant && compliant.lessThan(amount) ? toDecimalString(compliant) : null;
  const remainingAmount = maximumCompliantAmount ? toDecimalString(amount.minus(compliant!)) : null;
  const reasonCodes: PortfolioScenarioResult["reasonCodes"] = [
    "SCENARIO_APPLIED",
    normalizedKind === "EXTERNAL_BUY" ? "STANDALONE_BUY" : normalizedKind === "SELL" ? "STANDALONE_SELL" : "EXTERNAL_CONTRIBUTION",
  ];
  if (isPartial) reasonCodes.push("PARTIAL_VALUATION");
  if (input.hasStalePrices) reasonCodes.push("STALE_PRICE_DATA");
  if (newWarnings.length > 0) reasonCodes.push("NEW_WARNING");
  if (resolvedWarnings.length > 0) reasonCodes.push("WARNING_RESOLVED");
  if (maximumCompliantAmount !== null) reasonCodes.push("COMPLIANT_AMOUNT_AVAILABLE");

  return {
    kind: input.kind,
    accountId: input.accountId,
    assetId: input.assetId,
    symbol: asset.symbol,
    amount: toDecimalString(amount),
    quantity: toQuantityString(quantity),
    sourceAccountId: null,
    sourceAssetId: null,
    sourceSymbol: null,
    sourceAmount: null,
    sourceQuantity: null,
    destinationAccountId: null,
    destinationAssetId: null,
    destinationSymbol: null,
    destinationAmount: null,
    destinationQuantity: null,
    fee: null,
    current,
    projected,
    beforeComparison: input.strategy ? compareAllocationToStrategy(current, input.strategy) : [],
    afterComparison: input.strategy ? compareAllocationToStrategy(projected, input.strategy) : [],
    currentRisk,
    projectedRisk,
    currentWarnings,
    projectedWarnings,
    newWarnings,
    resolvedWarnings,
    maximumCompliantAmount,
    remainingAmount,
    reasonCodes,
  };
}

function calculateTradeScenario(input: CalculatePortfolioScenarioInput): PortfolioScenarioResult {
  const sourceAssetId = input.sourceAssetId ?? input.assetId;
  const sourceAccountId = input.sourceAccountId ?? input.accountId;
  const destinationAssetId = input.destinationAssetId ?? input.assetId;
  const destinationAccountId = input.destinationAccountId ?? input.accountId;
  const sourceAmount = requirePositiveMoney(input.sourceAmount ?? input.amount, "Scenario source amount");
  const fee = requireScenarioFee(input.fee ?? "0", sourceAmount);
  const sourceAsset = requireScenarioAsset(input, sourceAssetId, "Source asset");
  const destinationAsset = requireScenarioAsset(input, destinationAssetId, "Destination asset");
  if (sourceAsset.id === destinationAsset.id) throw new Error("Trade source and destination assets must be different.");
  requireScenarioAccount(input, sourceAccountId, "Source account");
  requireScenarioAccount(input, destinationAccountId, "Destination account");
  const sourcePrice = requireMarketPrice(input, sourceAsset.id, "Source price");
  const destinationPrice = requireMarketPrice(input, destinationAsset.id, "Destination price");
  const destinationAmount = sourceAmount.minus(fee);
  const sourceQuantity = sourceAmount.div(sourcePrice);
  const destinationQuantity = destinationAmount.div(destinationPrice);

  const current = calculatePortfolio(input);
  requireCompletePortfolioValuation(current);
  validateAccountSell(current, sourceAccountId, sourceAsset.id, sourceQuantity, sourceAsset.symbol);

  const currentRisk = riskFor(current, input);
  const currentWarnings = warningsFor(current, currentRisk, input);
  const projected = projectTrade(input, {
    sourceAccountId,
    sourceAssetId: sourceAsset.id,
    sourceQuantity,
    sourcePrice,
    destinationAccountId,
    destinationAssetId: destinationAsset.id,
    destinationQuantity,
    destinationPrice,
    fee,
  });
  const projectedRisk = riskFor(projected, input);
  const projectedWarnings = warningsFor(projected, projectedRisk, input);
  const currentKeys = new Set(currentWarnings.map(warningKey));
  const projectedKeys = new Set(projectedWarnings.map(warningKey));
  const newWarnings = projectedWarnings.filter((warning) => !currentKeys.has(warningKey(warning)));
  const resolvedWarnings = currentWarnings.filter((warning) => !projectedKeys.has(warningKey(warning)));
  const isPartial = current.missingPriceSymbols.length > 0 || projected.missingPriceSymbols.length > 0;
  const reasonCodes: PortfolioScenarioResult["reasonCodes"] = ["SCENARIO_APPLIED", "INTERNAL_TRADE"];
  if (isPartial) reasonCodes.push("PARTIAL_VALUATION");
  if (input.hasStalePrices) reasonCodes.push("STALE_PRICE_DATA");
  if (newWarnings.length > 0) reasonCodes.push("NEW_WARNING");
  if (resolvedWarnings.length > 0) reasonCodes.push("WARNING_RESOLVED");

  return {
    kind: "TRADE",
    accountId: destinationAccountId,
    assetId: destinationAsset.id,
    symbol: destinationAsset.symbol,
    amount: toDecimalString(sourceAmount),
    quantity: toQuantityString(destinationQuantity),
    sourceAccountId,
    sourceAssetId: sourceAsset.id,
    sourceSymbol: sourceAsset.symbol,
    sourceAmount: toDecimalString(sourceAmount),
    sourceQuantity: toQuantityString(sourceQuantity),
    destinationAccountId,
    destinationAssetId: destinationAsset.id,
    destinationSymbol: destinationAsset.symbol,
    destinationAmount: toDecimalString(destinationAmount),
    destinationQuantity: toQuantityString(destinationQuantity),
    fee: toDecimalString(fee),
    current,
    projected,
    beforeComparison: input.strategy ? compareAllocationToStrategy(current, input.strategy) : [],
    afterComparison: input.strategy ? compareAllocationToStrategy(projected, input.strategy) : [],
    currentRisk,
    projectedRisk,
    currentWarnings,
    projectedWarnings,
    newWarnings,
    resolvedWarnings,
    maximumCompliantAmount: null,
    remainingAmount: null,
    reasonCodes,
  };
}

function project(
  input: CalculatePortfolioScenarioInput,
  quantity: Prisma.Decimal,
  price: Prisma.Decimal,
) {
  return calculatePortfolio({
    assets: input.assets,
    marketPrices: input.marketPrices,
    transactions: [
      ...input.transactions,
      {
        accountId: input.accountId,
        assetId: input.assetId,
        type: input.kind === "SELL" ? TransactionType.SELL : input.kind === "CONTRIBUTION" ? TransactionType.DEPOSIT : TransactionType.BUY,
        quantity: toQuantityString(quantity),
        pricePerUnit: toDecimalString(price),
        currency: input.baseCurrency,
      },
    ],
  });
}

function projectTrade(
  input: CalculatePortfolioScenarioInput,
  trade: {
    sourceAccountId: string;
    sourceAssetId: string;
    sourceQuantity: Prisma.Decimal;
    sourcePrice: Prisma.Decimal;
    destinationAccountId: string;
    destinationAssetId: string;
    destinationQuantity: Prisma.Decimal;
    destinationPrice: Prisma.Decimal;
    fee: Prisma.Decimal;
  },
) {
  return calculatePortfolio({
    assets: input.assets,
    marketPrices: input.marketPrices,
    transactions: [
      ...input.transactions,
      {
        accountId: trade.sourceAccountId,
        assetId: trade.sourceAssetId,
        type: TransactionType.SELL,
        quantity: toQuantityString(trade.sourceQuantity),
        pricePerUnit: toDecimalString(trade.sourcePrice),
        currency: input.baseCurrency,
      },
      {
        accountId: trade.destinationAccountId,
        assetId: trade.destinationAssetId,
        type: TransactionType.BUY,
        quantity: toQuantityString(trade.destinationQuantity),
        pricePerUnit: toDecimalString(trade.destinationPrice),
        fee: toDecimalString(trade.fee),
        currency: input.baseCurrency,
      },
    ],
  });
}

function riskFor(portfolio: ReturnType<typeof calculatePortfolio>, input: CalculatePortfolioScenarioInput) {
  return calculatePortfolioRisk({
    portfolio,
    assets: input.assets,
    accounts: input.accounts,
    strategy: input.strategy,
    thresholds: input.riskThresholds,
    hasStalePrices: input.hasStalePrices,
  });
}

function warningsFor(
  portfolio: ReturnType<typeof calculatePortfolio>,
  risk: ReturnType<typeof calculatePortfolioRisk>,
  input: CalculatePortfolioScenarioInput,
): PortfolioScenarioWarning[] {
  const strategyWarnings = input.strategy ? evaluateStrategyCompliance(portfolio, input.strategy) : [];
  return [
    ...strategyWarnings.map((warning): PortfolioScenarioWarning => ({
      source: "STRATEGY",
      code: warning.code,
      subject: warning.assetClass,
      currentPercent: warning.currentPercent,
      limitPercent: warning.limitPercent,
      excessPercent: null,
    })),
    ...risk.violations.map((warning): PortfolioScenarioWarning => ({
      source: "RISK",
      code: warning.code,
      subject: warning.metric,
      currentPercent: warning.currentPercent,
      limitPercent: warning.limitPercent,
      excessPercent: warning.excessPercent,
    })),
  ];
}

function findMaximumCompliantAmount(
  input: CalculatePortfolioScenarioInput,
  requestedAmount: Prisma.Decimal,
  price: Prisma.Decimal,
  currentWarningKeys: Set<string>,
) {
  let low = ZERO;
  let high = requestedAmount.mul(100).floor();
  while (low.lessThan(high)) {
    const middle = low.plus(high).plus(1).div(2).floor();
    const candidate = middle.div(100);
    const projected = project(input, candidate.div(price), price);
    const projectedRisk = riskFor(projected, input);
    const introducesWarning = warningsFor(projected, projectedRisk, input)
      .some((warning) => !currentWarningKeys.has(warningKey(warning)));
    if (introducesWarning) high = middle.minus(1);
    else low = middle;
  }
  return low.div(100);
}

function capByStrategyClassMax(
  input: CalculatePortfolioScenarioInput,
  current: ReturnType<typeof calculatePortfolio>,
  assetClass: CalculatePortfolioScenarioInput["assets"][number]["assetClass"],
  candidate: Prisma.Decimal,
) {
  const strategyAllocation = input.strategy?.find((allocation) => allocation.assetClass === assetClass);
  if (!strategyAllocation) return candidate;
  const maxPercent = decimal(strategyAllocation.maxPercent);
  if (maxPercent.greaterThanOrEqualTo(100)) return candidate;

  const currentClassValue = decimal(current.allocation.find((allocation) => allocation.assetClass === assetClass)?.value ?? 0);
  const totalValue = decimal(current.totalValue);
  const maxFraction = maxPercent.div(100);
  const maximumAdditionalValue = maxFraction.mul(totalValue).minus(currentClassValue).div(decimal(1).minus(maxFraction));
  if (maximumAdditionalValue.lessThanOrEqualTo(ZERO)) return ZERO;

  const roundedDown = maximumAdditionalValue.mul(100).floor().div(100);
  return candidate.lessThan(roundedDown) ? candidate : roundedDown;
}

function validateAccountSell(
  current: ReturnType<typeof calculatePortfolio>,
  accountId: string,
  assetId: string,
  quantity: Prisma.Decimal,
  symbol: string,
) {
  const available = current.holdings
    .filter((holding) => holding.accountId === accountId && holding.assetId === assetId)
    .reduce((total, holding) => total.plus(holding.quantity), ZERO);
  if (quantity.greaterThan(available)) throw new Error(`Sell amount exceeds the available ${symbol} holding in the selected account.`);
}

function warningKey(warning: PortfolioScenarioWarning) {
  return `${warning.source}:${warning.code}:${warning.subject}`;
}

function requireScenarioAsset(input: CalculatePortfolioScenarioInput, assetId: string, label: string) {
  const asset = input.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`${label} was not found.`);
  return asset;
}

function requireScenarioAccount(input: CalculatePortfolioScenarioInput, accountId: string, label: string) {
  if (!input.accounts.some((account) => account.id === accountId)) throw new Error(`${label} was not found.`);
}

function requireMarketPrice(input: CalculatePortfolioScenarioInput, assetId: string, label: string) {
  const asset = requireScenarioAsset(input, assetId, label);
  const rawPrice = input.marketPrices[asset.symbol];
  if (rawPrice === undefined) throw new Error(`${label} is unavailable for ${asset.symbol}.`);
  const price = decimal(rawPrice);
  if (!price.isFinite() || !price.greaterThan(ZERO)) throw new Error(`${label} must be greater than zero for ${asset.symbol}.`);
  return price;
}

function requirePositiveMoney(value: CalculatePortfolioScenarioInput["amount"], label: string) {
  let amount: Prisma.Decimal;
  try {
    amount = decimal(value);
  } catch {
    throw new Error(`${label} must be a valid number.`);
  }
  if (!amount.isFinite() || amount.decimalPlaces() > 2 || !amount.greaterThan(ZERO)) {
    throw new Error(`${label} must be positive with at most two decimal places.`);
  }
  return amount;
}

function requireScenarioFee(value: CalculatePortfolioScenarioInput["fee"], sourceAmount: Prisma.Decimal) {
  let fee: Prisma.Decimal;
  try {
    fee = decimal(value ?? "0");
  } catch {
    throw new Error("Scenario fee must be a valid number.");
  }
  if (!fee.isFinite() || fee.decimalPlaces() > 2 || fee.lessThan(ZERO)) {
    throw new Error("Scenario fee must be non-negative with at most two decimal places.");
  }
  if (!fee.lessThan(sourceAmount)) throw new Error("Scenario fee must be less than the source amount.");
  return fee;
}
