import { AssetClass, AssetType, TransactionType, type Prisma } from "@prisma/client";

export type DecimalLike = Prisma.Decimal | string | number;

export type EngineAsset = {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  assetType: AssetType;
  currency?: string;
};

export type EngineTransaction = {
  id?: string;
  assetId: string;
  accountId: string;
  type: TransactionType;
  quantity: DecimalLike;
  pricePerUnit?: DecimalLike | null;
  fee?: DecimalLike | null;
  currency?: string;
  executedAt?: Date | string;
};

export type EngineStrategyAllocation = {
  assetClass: AssetClass;
  targetPercent: DecimalLike;
  minPercent: DecimalLike;
  maxPercent: DecimalLike;
};

export type MarketPrices = Record<string, DecimalLike>;

export type Holding = {
  assetId: string;
  accountId: string;
  quantity: string;
};

export type ValuedHolding = Holding & {
  symbol: string;
  assetClass: AssetClass;
  assetType: AssetType;
  price: string;
  value: string;
};

export type AssetClassAllocation = {
  assetClass: AssetClass;
  value: string;
  percentage: string;
};

export type AllocationStatus = "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT";

export type AllocationComparison = {
  assetClass: AssetClass;
  currentPercent: string;
  targetPercent: string;
  minPercent: string;
  maxPercent: string;
  driftFromTarget: string;
  status: AllocationStatus;
  reasonCodes: ReasonCode[];
};

export type ReasonCode =
  | "ASSET_CLASS_UNDERWEIGHT"
  | "ASSET_CLASS_OVERWEIGHT"
  | "ABOVE_MAX_RANGE"
  | "BELOW_MIN_RANGE"
  | "CONTRIBUTION_MOVES_TOWARD_TARGET"
  | "NO_SELL_REQUIRED"
  | "NO_CONTRIBUTION"
  | "MISSING_MARKET_PRICE"
  | "OVERWEIGHT_CLASS_RECEIVES_NO_CONTRIBUTION"
  | "CUSTOM_ALLOCATION_ABOVE_MAX";

export type ContributionReason = {
  code: ReasonCode;
  assetClass?: AssetClass;
};

export type ViolationCode = `${AssetClass}_ABOVE_MAX` | `${AssetClass}_BELOW_MIN`;

export type StrategyWarning = {
  code: ViolationCode;
  assetClass: AssetClass;
  currentPercent: string;
  limitPercent: string;
  reasonCodes: ReasonCode[];
};

export type PortfolioSnapshot = {
  holdings: Holding[];
  valuedHoldings: ValuedHolding[];
  totalValue: string;
  allocation: AssetClassAllocation[];
  missingPriceSymbols: string[];
};

export type CalculatePortfolioInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  marketPrices: MarketPrices;
};

export type PortfolioAnalytics = {
  totalUnrealizedPnl: string | null;
  priceCoverage: {
    pricedHoldings: number;
    totalHoldings: number;
    percent: string;
  };
  accounts: Array<{
    accountId: string;
    value: string;
    isPartial: boolean;
  }>;
};

export type CalculatePortfolioAnalyticsInput = {
  portfolio: PortfolioSnapshot;
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  baseCurrency: string;
};

export type StrategyAlignment = {
  score: number | null;
  allocationPoints: number;
  allocationMaxPoints: 80;
  priceDataPoints: number;
  priceDataMaxPoints: 20;
  inRangeClasses: number;
  totalClasses: number;
  pricedHoldings: number;
  totalHoldings: number;
};

export type CalculateStrategyAlignmentInput = {
  comparisons: AllocationComparison[];
  pricedHoldings: number;
  totalHoldings: number;
};

export type ContributionAllocation = {
  assetClass: AssetClass;
  amount: string;
  percentOfContribution: string;
};

export type ContributionPlan = {
  contributionAmount: string;
  allocations: ContributionAllocation[];
  before: PortfolioSnapshot;
  projectedAfter: PortfolioSnapshot;
  reasons: ReasonCode[];
};

export type PlanContributionInput = {
  portfolio: PortfolioSnapshot;
  strategy: EngineStrategyAllocation[];
  contributionAmount: DecimalLike;
};

export type ContributionProjection = {
  plan: ContributionPlan;
  beforeComparison: AllocationComparison[];
  afterComparison: AllocationComparison[];
  warnings: StrategyWarning[];
  reasons: ContributionReason[];
  isCustomized: boolean;
};

export type ProjectContributionInput = PlanContributionInput & {
  allocations: Array<{
    assetClass: AssetClass;
    amount: DecimalLike;
  }>;
};

export type SimulateContributionInput = CalculatePortfolioInput & {
  strategy: EngineStrategyAllocation[];
  contributionAmount: DecimalLike;
};

export type SimulatedTransactionInput = CalculatePortfolioInput & {
  transaction: EngineTransaction;
};
