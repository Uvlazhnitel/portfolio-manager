import type { AllocationComparison, EngineAsset, EngineStrategyAllocation, EngineTransaction, MarketPrices, PortfolioSnapshot, StrategyWarning } from "@/features/portfolio-engine";

export const scenarioBuckets = ["ETF", "BTC", "ETH", "GOLD", "CASH"] as const;
export type ScenarioBucket = (typeof scenarioBuckets)[number];
export type ScenarioTransactionType = "BUY" | "SELL";

export type TransactionScenarioInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  marketPrices: MarketPrices;
  strategy: EngineStrategyAllocation[];
  baseCurrency?: string;
  assetId: string;
  type: ScenarioTransactionType;
  amount: string;
};

export type TransactionScenarioResult = {
  assetId: string;
  symbol: string;
  type: ScenarioTransactionType;
  amount: string;
  quantity: string;
  current: PortfolioSnapshot;
  projected: PortfolioSnapshot;
  beforeComparison: AllocationComparison[];
  afterComparison: AllocationComparison[];
  warnings: StrategyWarning[];
  reasonCodes: Array<"EXTERNAL_CASHFLOW" | "PROJECTED_ABOVE_MAX" | "PARTIAL_VALUATION">;
};

export type MarketScenarioInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  marketPrices: MarketPrices;
  shocks: Record<ScenarioBucket, string>;
};

export type MarketScenarioResult = {
  currentValue: string;
  scenarioValue: string;
  absoluteChange: string;
  percentageChange: string | null;
  contributions: Array<{ bucket: ScenarioBucket; amount: string; shockPercent: string }>;
  current: PortfolioSnapshot;
  projected: PortfolioSnapshot;
  isPartial: boolean;
  missingPriceSymbols: string[];
};
