import { TransactionType, type Prisma } from "@prisma/client";
import { decimal, toDecimalString, toQuantityString, ZERO } from "@/features/portfolio-engine/decimal";
import {
  calculatePortfolio,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
} from "@/features/portfolio-engine/engine";
import { calculatePortfolioRisk } from "@/features/portfolio-engine/risk";
import type {
  CalculatePortfolioScenarioInput,
  PortfolioScenarioResult,
  PortfolioScenarioWarning,
} from "@/features/portfolio-engine/types";

export function calculatePortfolioScenario(input: CalculatePortfolioScenarioInput): PortfolioScenarioResult {
  const amount = requirePositiveMoney(input.amount);
  const asset = input.assets.find((candidate) => candidate.id === input.assetId);
  if (!asset) throw new Error("Selected asset was not found.");
  if (!input.accounts.some((account) => account.id === input.accountId)) throw new Error("Selected account was not found.");

  const rawPrice = input.marketPrices[asset.symbol];
  if (rawPrice === undefined) throw new Error(`Current price is unavailable for ${asset.symbol}.`);
  const price = decimal(rawPrice);
  if (!price.isFinite() || !price.greaterThan(ZERO)) throw new Error(`Current price must be greater than zero for ${asset.symbol}.`);

  const current = calculatePortfolio(input);
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
  const compliant = input.kind !== "SELL" && newWarnings.length > 0 && !isPartial
    ? findMaximumCompliantAmount(input, amount, price, currentKeys)
    : null;
  const maximumCompliantAmount = compliant && compliant.lessThan(amount) ? toDecimalString(compliant) : null;
  const remainingAmount = maximumCompliantAmount ? toDecimalString(amount.minus(compliant!)) : null;
  const reasonCodes: PortfolioScenarioResult["reasonCodes"] = [
    "SCENARIO_APPLIED",
    input.kind === "BUY" ? "STANDALONE_BUY" : input.kind === "SELL" ? "STANDALONE_SELL" : "EXTERNAL_CONTRIBUTION",
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

function requirePositiveMoney(value: CalculatePortfolioScenarioInput["amount"]) {
  let amount: Prisma.Decimal;
  try {
    amount = decimal(value);
  } catch {
    throw new Error("Scenario amount must be a valid number.");
  }
  if (!amount.isFinite() || amount.decimalPlaces() > 2 || !amount.greaterThan(ZERO)) {
    throw new Error("Scenario amount must be positive with at most two decimal places.");
  }
  return amount;
}
