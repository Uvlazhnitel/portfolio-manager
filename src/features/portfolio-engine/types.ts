import { AssetClass, AssetType, BasisMethod, TransactionGroupKind, TransactionType, type Prisma } from "@prisma/client";

export type DecimalLike = Prisma.Decimal | string | number;

export type EngineAsset = {
  id: string;
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  assetType: AssetType;
  currency?: string;
};

export type EngineTransaction = {
  id?: string;
  assetId: string;
  accountId: string;
  type: TransactionType;
  basisMethod?: BasisMethod | null;
  quantity: DecimalLike;
  pricePerUnit?: DecimalLike | null;
  fee?: DecimalLike | null;
  currency?: string;
  executedAt?: Date | string;
  transactionGroupId?: string | null;
  transactionGroup?: { kind: TransactionGroupKind } | null;
};

export type EngineStrategyAllocation = {
  assetClass: AssetClass;
  targetPercent: DecimalLike;
  minPercent: DecimalLike;
  maxPercent: DecimalLike;
  assetAllocations?: EngineStrategyAssetAllocation[];
};

export type EngineStrategyAssetAllocation = {
  assetId: string;
  targetPercent: DecimalLike;
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
  investmentGain: string | null;
  netInvested: string;
  netContributed: string;
  externalContributions: string | null;
  externalWithdrawals: string | null;
  openingBasis: string;
  giftTrackingBasis: string;
  internalTradeFees: string;
  trackedCapital: string;
  trackedCapitalReturnPercent: string | null;
  isNetInvestedPartial: boolean;
  missingNetInvestedSymbols: string[];
  coveredSymbols: string[];
  openingBasisUnknownSymbols: string[];
  performanceExclusions: PerformanceExclusion[];
  isCostBasisPartial: boolean;
  missingCostBasisSymbols: string[];
  isExternalCashflowPartial: boolean;
  missingExternalCashflowSymbols: string[];
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

export type HistoricalMarketSnapshot = {
  date: string;
  marketPrices: MarketPrices;
  hasStalePrices: boolean;
};

export type PortfolioPerformancePoint = {
  date: string;
  portfolioValue: string | null;
  netInvested: string;
  externalContributions: string | null;
  externalWithdrawals: string | null;
  openingBasis: string;
  giftTrackingBasis: string;
  internalTradeFees: string;
  investmentGain: string | null;
  trackedCapital: string;
  trackedCapitalReturnPercent: string | null;
  isComplete: boolean;
  missingPriceSymbols: string[];
  isCostBasisPartial: boolean;
  missingCostBasisSymbols: string[];
  isNetInvestedPartial: boolean;
  missingNetInvestedSymbols: string[];
  isExternalCashflowPartial: boolean;
  missingExternalCashflowSymbols: string[];
  coveredSymbols: string[];
  openingBasisUnknownSymbols: string[];
  performanceExclusions: PerformanceExclusion[];
  hasStalePrices: boolean;
};

export type PerformanceExclusionReason =
  | "MISSING_CURRENT_PRICE"
  | "UNKNOWN_OPENING_BASIS"
  | "MISSING_ACQUISITION_PRICE"
  | "UNSUPPORTED_TRANSACTION_CURRENCY"
  | "AMBIGUOUS_TRANSFER_BASIS"
  | "INCONSISTENT_TRANSACTION_HISTORY"
  | "LINKED_TRADE_COMPONENT_PARTIAL";

export type PerformanceExclusion = {
  symbol: string;
  reasons: PerformanceExclusionReason[];
};

export type CalculateHistoricalPerformanceInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  baseCurrency: string;
  snapshots: HistoricalMarketSnapshot[];
};

export type DailyBriefStatus = "ACTION" | "MONITOR" | "NO_ACTION";

export type DailyBriefReasonCode =
  | "NEW_STRATEGY_VIOLATION"
  | "MINIMUM_REBALANCE_DRIFT_EXCEEDED"
  | "BELOW_MINIMUM_REBALANCE_DRIFT"
  | "EXISTING_VIOLATION_WORSENED"
  | "STRATEGY_VIOLATION_RESOLVED"
  | "CONTRIBUTION_FIRST_REVIEW"
  | "STRATEGY_CHALLENGE_DISABLED"
  | "STALE_PRICE_DATA"
  | "INSUFFICIENT_DAILY_DATA"
  | "NO_MEANINGFUL_STRATEGY_CHANGE";

export type DailyBriefUnavailableReason =
  | "NO_PREVIOUS_OBSERVATION"
  | "PREVIOUS_VALUATION_INCOMPLETE"
  | "CURRENT_VALUATION_INCOMPLETE"
  | "INCOMPLETE_EXTERNAL_CASHFLOWS"
  | "INVALID_PREVIOUS_VALUE";

export type DailyBriefStrategyRules = {
  preferContributionsOverSelling: boolean;
  challengeStrategyViolations: boolean;
  preferNoActionWhenEvidenceWeak: boolean;
  minimumRebalanceDrift: DecimalLike;
};

export type DailyBriefContributor = {
  assetId: string;
  symbol: string;
  contribution: string;
  priceChangePercent: string;
};

export type DailyBriefAllocationChange = AllocationComparison & {
  previousPercent: string;
  previousDriftFromTarget: string;
  driftChange: string;
  previousStatus: AllocationStatus;
};

export type DailyBriefRiskSignal = {
  code: "LARGEST_ASSET" | "LARGEST_CUSTODY_ACCOUNT" | "CRYPTO_ALLOCATION";
  label: string;
  value: string;
  detail: string;
  tone: "NEUTRAL" | "WARNING";
};

export type DailyBriefResult = {
  status: DailyBriefStatus;
  summary: string;
  reasonCodes: DailyBriefReasonCode[];
  currentDate: string;
  previousDate: string | null;
  currentValue: string | null;
  previousValue: string | null;
  portfolioValueChange: string | null;
  dailyGain: string | null;
  dailyReturnPercent: string | null;
  externalContributions: string | null;
  externalWithdrawals: string | null;
  unavailableReason: DailyBriefUnavailableReason | null;
  isStale: boolean;
  missingPriceSymbols: string[];
  positiveContributors: DailyBriefContributor[];
  negativeContributors: DailyBriefContributor[];
  allocationChanges: DailyBriefAllocationChange[];
  newViolations: StrategyWarning[];
  resolvedViolations: StrategyWarning[];
  currentViolations: StrategyWarning[];
  riskSignals: DailyBriefRiskSignal[];
};

export type CalculateDailyBriefInput = {
  assets: EngineAsset[];
  accounts: Array<{ id: string; name: string; type: string }>;
  transactions: EngineTransaction[];
  baseCurrency: string;
  currentMarketPrices: MarketPrices;
  currentHasStalePrices: boolean;
  history: HistoricalMarketSnapshot[];
  strategy: EngineStrategyAllocation[] | null;
  rules: DailyBriefStrategyRules;
  asOf: Date | string;
};

export const performanceRanges = ["7D", "1M", "3M", "1Y", "ALL"] as const;

export type PerformanceRange = (typeof performanceRanges)[number];

export type AdvancedMetricUnavailableReason =
  | "INSUFFICIENT_HISTORY"
  | "INCOMPLETE_VALUATION"
  | "INCOMPLETE_EXTERNAL_CASHFLOWS"
  | "INVALID_START_VALUE"
  | "XIRR_NO_SOLUTION"
  | "XIRR_AMBIGUOUS_SOLUTION"
  | "BENCHMARK_NOT_CONFIGURED"
  | "MISSING_BENCHMARK_PRICES";

export type AdvancedPerformanceMetric = {
  value: string | null;
  startDate: string | null;
  endDate: string | null;
  isStale: boolean;
  unavailableReason: AdvancedMetricUnavailableReason | null;
};

export type AdvancedPerformanceObservation = {
  date: string;
  portfolioValue: string | null;
  externalContributions: string | null;
  externalWithdrawals: string | null;
  isComplete: boolean;
  hasStalePrices: boolean;
};

export type BenchmarkPerformanceObservation = {
  date: string;
  price: string;
  hasStalePrices: boolean;
};

export type BenchmarkComparisonPoint = {
  date: string;
  portfolioIndex: string;
  benchmarkIndex: string;
  portfolioReturnPercent: string;
  benchmarkReturnPercent: string;
  hasStalePrices: boolean;
};

export type BenchmarkComparison = {
  points: BenchmarkComparisonPoint[];
  startDate: string | null;
  endDate: string | null;
  isPartial: boolean;
  isStale: boolean;
  unavailableReason: AdvancedMetricUnavailableReason | null;
};

export type AdvancedPerformance = {
  twr: AdvancedPerformanceMetric;
  xirr: AdvancedPerformanceMetric;
  ytdReturn: AdvancedPerformanceMetric;
  oneYearReturn: AdvancedPerformanceMetric;
  maxDrawdown: AdvancedPerformanceMetric;
  comparisons: Record<PerformanceRange, BenchmarkComparison>;
};

export type CalculateAdvancedPerformanceInput = {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  baseCurrency: string;
  history: AdvancedPerformanceObservation[];
  current: AdvancedPerformanceObservation;
  asOf: Date | string;
  benchmark: {
    assetId: string;
    observations: BenchmarkPerformanceObservation[];
    current: BenchmarkPerformanceObservation | null;
  } | null;
};

export type HoldingCostBasisReason =
  | "NON_POSITIVE_HOLDING"
  | "MISSING_ACQUISITION_PRICE"
  | "UNSUPPORTED_TRANSACTION_CURRENCY"
  | "ACCOUNT_TRANSFER_COST_UNKNOWN"
  | "UNSUPPORTED_QUANTITY_MOVEMENT"
  | "INCONSISTENT_TRANSACTION_HISTORY";

export type HoldingCostBasis = {
  accountId: string;
  assetId: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  totalCost: string | null;
  averageAcquisitionPrice: string | null;
  reason: HoldingCostBasisReason | null;
};

export type AssetNetCostBasis = {
  assetId: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  netCost: string | null;
  averageNetCost: string | null;
  reason: HoldingCostBasisReason | null;
};

export type CalculateHoldingCostBasisInput = {
  portfolio: PortfolioSnapshot;
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  baseCurrency: string;
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

export type ContributionAssetRecommendation = {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  amount: string;
  percentOfContribution: string;
  targetPercentOfClass: string;
  effectiveTargetPercent: string;
};

export type ContributionPlan = {
  contributionAmount: string;
  allocations: ContributionAllocation[];
  assetRecommendations: ContributionAssetRecommendation[];
  before: PortfolioSnapshot;
  projectedAfter: PortfolioSnapshot;
  reasons: ReasonCode[];
};

export type PlanContributionInput = {
  portfolio: PortfolioSnapshot;
  assets: EngineAsset[];
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
