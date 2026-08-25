import { AssetClass, TransactionType, type Prisma } from "@prisma/client";
import { calculatePortfolio, compareAllocationToStrategy, evaluateStrategyCompliance, simulateTransaction } from "@/features/portfolio-engine";
import { decimal, ONE_HUNDRED, toDecimalString, toQuantityString, ZERO } from "@/features/portfolio-engine/decimal";
import { scenarioBuckets, type MarketScenarioInput, type ScenarioBucket, type TransactionScenarioInput } from "@/features/scenarios/types";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

const SCENARIO_ACCOUNT_ID = "__scenario__";

export function simulateTransactionScenario(input: TransactionScenarioInput) {
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
      accountId: SCENARIO_ACCOUNT_ID,
      assetId: asset.id,
      type: input.type === "BUY" ? TransactionType.BUY : TransactionType.SELL,
      quantity: toQuantityString(quantity),
      pricePerUnit: toDecimalString(price),
      currency: input.baseCurrency ?? DEFAULT_BASE_CURRENCY,
    },
  });
  const warnings = evaluateStrategyCompliance(projected, input.strategy);
  const reasonCodes: Array<"EXTERNAL_CASHFLOW" | "PROJECTED_ABOVE_MAX" | "PARTIAL_VALUATION"> = ["EXTERNAL_CASHFLOW"];
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

export function simulateMarketScenario(input: MarketScenarioInput) {
  const shocks = Object.fromEntries(
    scenarioBuckets.map((bucket) => {
      const shock = finiteDecimal(input.shocks[bucket], `${bucket} shock`);
      if (shock.lessThan(-100) || shock.greaterThan(1000)) {
        throw new Error(`${bucket} shock must be between -100% and 1000%.`);
      }
      return [bucket, shock] as const;
    }),
  ) as Record<ScenarioBucket, Prisma.Decimal>;
  const current = calculatePortfolio(input);
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const scenarioPrices = { ...input.marketPrices };

  for (const asset of input.assets) {
    const rawPrice = input.marketPrices[asset.symbol];
    const bucket = bucketForAsset(asset);
    if (rawPrice === undefined || bucket === null) continue;
    const price = finiteDecimal(rawPrice, `${asset.symbol} price`);
    scenarioPrices[asset.symbol] = price.mul(ONE_HUNDRED.plus(shocks[bucket])).div(ONE_HUNDRED);
  }

  const projected = calculatePortfolio({ ...input, marketPrices: scenarioPrices });
  const contributions = scenarioBuckets.map((bucket) => {
    const currentBucketValue = current.valuedHoldings.reduce((total, holding) => {
      const asset = assetById.get(holding.assetId);
      return asset && bucketForAsset(asset) === bucket ? total.plus(decimal(holding.value)) : total;
    }, ZERO);
    return {
      bucket,
      amount: toDecimalString(currentBucketValue.mul(shocks[bucket]).div(ONE_HUNDRED)),
      shockPercent: toDecimalString(shocks[bucket]),
    };
  });
  const currentValue = decimal(current.totalValue);
  const scenarioValue = decimal(projected.totalValue);
  const absoluteChange = scenarioValue.minus(currentValue);

  return {
    currentValue: toDecimalString(currentValue),
    scenarioValue: toDecimalString(scenarioValue),
    absoluteChange: toDecimalString(absoluteChange),
    percentageChange: currentValue.equals(ZERO)
      ? null
      : toDecimalString(absoluteChange.div(currentValue).mul(ONE_HUNDRED)),
    contributions,
    current,
    projected,
    isPartial: current.missingPriceSymbols.length > 0,
    missingPriceSymbols: current.missingPriceSymbols,
  };
}

function bucketForAsset(asset: { symbol: string; assetClass: AssetClass }): ScenarioBucket | null {
  if (asset.assetClass === AssetClass.ETF) return "ETF";
  if (asset.symbol.toUpperCase() === "BTC") return "BTC";
  if (asset.symbol.toUpperCase() === "ETH") return "ETH";
  if (asset.assetClass === AssetClass.GOLD) return "GOLD";
  if (asset.assetClass === AssetClass.CASH) return "CASH";
  return null;
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
