import { TransactionType, type Prisma } from "@prisma/client";
import { calculatePortfolio, compareAllocationToStrategy, evaluateStrategyCompliance, simulateTransaction } from "@/features/portfolio-engine";
import type { AllocationComparison, EngineAsset, EngineStrategyAllocation, EngineTransaction, MarketPrices, PortfolioSnapshot, StrategyWarning } from "@/features/portfolio-engine";
import { decimal, toDecimalString, toQuantityString, ZERO } from "@/features/portfolio-engine/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

const ASSISTANT_CHECK_ACCOUNT_ID = "__assistant_check__";

type AssistantTransactionCheckInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  marketPrices: MarketPrices;
  strategy: EngineStrategyAllocation[];
  baseCurrency?: string;
  assetId: string;
  type: "BUY" | "SELL";
  amount: string;
};

type AssistantTransactionCheckResult = {
  assetId: string;
  symbol: string;
  type: "BUY" | "SELL";
  amount: string;
  quantity: string;
  current: PortfolioSnapshot;
  projected: PortfolioSnapshot;
  beforeComparison: AllocationComparison[];
  afterComparison: AllocationComparison[];
  warnings: StrategyWarning[];
  reasonCodes: Array<"EXTERNAL_CASHFLOW" | "PROJECTED_ABOVE_MAX" | "PARTIAL_VALUATION">;
};

export function checkAssistantTransaction(input: AssistantTransactionCheckInput): AssistantTransactionCheckResult {
  const amount = finiteDecimal(input.amount, "Transaction amount");
  if (!amount.greaterThan(ZERO)) throw new Error("Transaction amount must be greater than zero.");

  const asset = input.assets.find((candidate) => candidate.id === input.assetId);
  if (!asset) throw new Error("Selected asset was not found.");
  const rawPrice = input.marketPrices[asset.symbol];
  if (rawPrice === undefined) throw new Error(`Current price is unavailable for ${asset.symbol}.`);
  const price = finiteDecimal(rawPrice, `${asset.symbol} price`);
  if (!price.greaterThan(ZERO)) throw new Error(`Current price must be greater than zero for ${asset.symbol}.`);

  const quantity = amount.div(price);
  const current = calculatePortfolio(input);
  if (input.type === "SELL") {
    const available = current.holdings
      .filter((holding) => holding.assetId === asset.id)
      .reduce((total, holding) => total.plus(decimal(holding.quantity)), ZERO);
    if (quantity.greaterThan(available)) {
      throw new Error(`Sell amount exceeds the available ${asset.symbol} holding.`);
    }
  }

  const projected = simulateTransaction({
    assets: input.assets,
    transactions: input.transactions,
    marketPrices: input.marketPrices,
    transaction: {
      accountId: ASSISTANT_CHECK_ACCOUNT_ID,
      assetId: asset.id,
      type: input.type === "BUY" ? TransactionType.BUY : TransactionType.SELL,
      quantity: toQuantityString(quantity),
      pricePerUnit: toDecimalString(price),
      currency: input.baseCurrency ?? DEFAULT_BASE_CURRENCY,
    },
  });
  const warnings = evaluateStrategyCompliance(projected, input.strategy);
  const reasonCodes: AssistantTransactionCheckResult["reasonCodes"] = ["EXTERNAL_CASHFLOW"];
  if (warnings.some((warning) => warning.code.endsWith("_ABOVE_MAX"))) reasonCodes.push("PROJECTED_ABOVE_MAX");
  if (current.missingPriceSymbols.length > 0 || projected.missingPriceSymbols.length > 0) reasonCodes.push("PARTIAL_VALUATION");

  return {
    assetId: asset.id,
    symbol: asset.symbol,
    type: input.type,
    amount: toDecimalString(amount),
    quantity: toQuantityString(quantity),
    current,
    projected,
    beforeComparison: compareAllocationToStrategy(current, input.strategy),
    afterComparison: compareAllocationToStrategy(projected, input.strategy),
    warnings,
    reasonCodes,
  };
}

function finiteDecimal(value: Parameters<typeof decimal>[0], label: string) {
  let parsed: Prisma.Decimal;
  try {
    parsed = decimal(value);
  } catch {
    throw new Error(`${label} must be a valid number.`);
  }
  if (!parsed.isFinite()) throw new Error(`${label} must be a finite number.`);
  return parsed;
}
