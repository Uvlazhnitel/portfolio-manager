import type { AssetClass, DailyMarketPrice } from "@prisma/client";
import {
  calculateHistoricalPerformance,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  getPortfolioValuationAvailability,
  type AllocationStatus,
  type ContributionProjection,
  type HistoricalMarketSnapshot,
  type PortfolioPerformancePoint,
} from "@/features/portfolio-engine";
import { buildSavedContributionProjection } from "@/features/contributions/saved-plan";
import { decimal, toDecimalString } from "@/features/portfolio-engine/decimal";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { buildPortfolioValuationPresentation } from "@/features/portfolio/valuation-presentation";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export type DashboardReadModel = {
  valuation: {
    totalValue: string;
    exactTotalValue: string | null;
    knownValuedSubtotal: string;
    investmentGain: string | null;
    netInvested: string;
    trackedCapital: string;
    openingBasis: string;
    giftTrackingBasis: string;
    trackedCapitalReturnPercent: string | null;
    isCostBasisPartial: boolean;
    missingCostBasisSymbols: string[];
    currency: string;
    isPartial: boolean;
    missingPriceSymbols: string[];
    lastUpdated: string | null;
    hasStalePrices: boolean;
    warning: string | null;
  };
  history: {
    points: PortfolioPerformancePoint[];
    trackingStartedAt: string | null;
    incompleteDates: number;
    staleDates: number;
  };
  allocation: {
    state: "AVAILABLE" | "PARTIAL";
    reasonCodes: string[];
    missingPriceSymbols: string[];
    rows: Array<{
      assetClass: AssetClass;
      value: string;
      currentPercent: string;
      targetPercent: string;
      minPercent: string;
      maxPercent: string;
      driftPercent: string;
      status: AllocationStatus;
    }>;
  };
  contribution: {
    amount: string;
    projection: ContributionProjection | null;
    state: "AVAILABLE" | "UNAVAILABLE";
    reasonCodes: string[];
    missingPriceSymbols: string[];
  };
  strategyStatus: {
    state: "EMPTY" | "UNAVAILABLE" | "STAY_CONSISTENT" | "NEEDS_ATTENTION";
    strategyName: string | null;
    attentionCount: number | null;
    totalClasses: number;
    reasonCodes: string[];
    missingPriceSymbols: string[];
  };
};

export async function getDashboardReadModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  contributionPlanRepository = new ContributionPlanRepository(),
  marketDataService = new MarketDataService(),
  dailyPriceStore = new DailyMarketPriceRepository(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  contributionPlanRepository?: ContributionPlanRepository;
  marketDataService?: MarketDataService;
  dailyPriceStore?: DailyMarketPriceStore;
} = {}): Promise<DashboardReadModel> {
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [marketData, savedPlan, dailyPrices] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency }),
    strategy ? contributionPlanRepository.findByStrategyId(strategy.id) : null,
    dailyPriceStore.listDailyPrices(baseCurrency),
  ]);
  const portfolio = calculatePortfolio({ assets, transactions, marketPrices: toEngineMarketPrices(marketData) });
  const valuationPresentation = buildPortfolioValuationPresentation(portfolio);
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency });
  const valuationAvailability = getPortfolioValuationAvailability(portfolio);
  const canEvaluateAllocation = valuationAvailability.state === "AVAILABLE";
  const comparisons = strategy && canEvaluateAllocation ? compareAllocationToStrategy(portfolio, strategy.allocations) : [];
  const warnings = strategy && canEvaluateAllocation ? evaluateStrategyCompliance(portfolio, strategy.allocations) : [];
  const allocationByClass = new Map(portfolio.allocation.map((item) => [item.assetClass, item]));
  const contributionAmount = savedPlan ? serializeDecimal(savedPlan.contributionAmount) : "";
  let contributionProjection: ContributionProjection | null = null;
  if (strategy && savedPlan && canEvaluateAllocation && contributionAmount && contributionAmount !== "0") {
    try {
      contributionProjection = buildSavedContributionProjection({ portfolio, assets, strategy: strategy.allocations, savedPlan });
    } catch {
      contributionProjection = null;
    }
  }
  const history = calculateHistoricalPerformance({
    assets,
    transactions,
    baseCurrency,
    snapshots: buildHistoricalSnapshots(assets, dailyPrices),
  });
  const hasHoldings = analytics.priceCoverage.totalHoldings > 0;

  const allocation = comparisons
    .map((comparison) => ({
      assetClass: comparison.assetClass,
      value: allocationByClass.get(comparison.assetClass)?.value ?? "0.00",
      currentPercent: comparison.currentPercent,
      targetPercent: comparison.targetPercent,
      minPercent: comparison.minPercent,
      maxPercent: comparison.maxPercent,
      driftPercent: toDecimalString(decimal(comparison.currentPercent).minus(comparison.targetPercent)),
      status: comparison.status,
    }))
    .sort((left, right) => {
      const leftAttention = left.status === "IN_RANGE" ? 1 : 0;
      const rightAttention = right.status === "IN_RANGE" ? 1 : 0;
      if (leftAttention !== rightAttention) return leftAttention - rightAttention;
      const driftDifference = Math.abs(Number(right.driftPercent)) - Math.abs(Number(left.driftPercent));
      return driftDifference || left.assetClass.localeCompare(right.assetClass);
    });

  return {
    valuation: {
      totalValue: portfolio.totalValue,
      exactTotalValue: valuationPresentation.exactTotalValue,
      knownValuedSubtotal: valuationPresentation.knownValuedSubtotal,
      investmentGain: analytics.investmentGain,
      netInvested: analytics.netInvested,
      trackedCapital: analytics.trackedCapital,
      openingBasis: analytics.openingBasis,
      giftTrackingBasis: analytics.giftTrackingBasis,
      trackedCapitalReturnPercent: analytics.trackedCapitalReturnPercent,
      isCostBasisPartial: analytics.isCostBasisPartial,
      missingCostBasisSymbols: analytics.missingCostBasisSymbols,
      currency: baseCurrency,
      isPartial: valuationPresentation.isPartial,
      missingPriceSymbols: valuationPresentation.missingPriceSymbols,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
    },
    history: {
      points: history,
      trackingStartedAt: history[0]?.date ?? null,
      incompleteDates: history.filter((point) => !point.isComplete).length,
      staleDates: history.filter((point) => point.hasStalePrices).length,
    },
    allocation: {
      state: valuationAvailability.state,
      reasonCodes: valuationAvailability.reasonCodes,
      missingPriceSymbols: valuationAvailability.missingPriceSymbols,
      rows: allocation,
    },
    contribution: {
      amount: contributionAmount,
      projection: contributionProjection,
      state: canEvaluateAllocation ? "AVAILABLE" : "UNAVAILABLE",
      reasonCodes: valuationAvailability.reasonCodes,
      missingPriceSymbols: valuationAvailability.missingPriceSymbols,
    },
    strategyStatus: {
      state: !hasHoldings ? "EMPTY" : !canEvaluateAllocation ? "UNAVAILABLE" : warnings.length > 0 ? "NEEDS_ATTENTION" : "STAY_CONSISTENT",
      strategyName: strategy?.name ?? null,
      attentionCount: canEvaluateAllocation ? warnings.length : null,
      totalClasses: strategy?.allocations.length ?? 0,
      reasonCodes: valuationAvailability.reasonCodes,
      missingPriceSymbols: valuationAvailability.missingPriceSymbols,
    },
  };
}

function buildHistoricalSnapshots(
  assets: Array<{ id: string; symbol: string }>,
  dailyPrices: DailyMarketPrice[],
): HistoricalMarketSnapshot[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const byDate = new Map<string, { marketPrices: Record<string, string>; hasStalePrices: boolean }>();

  for (const dailyPrice of dailyPrices) {
    const asset = assetById.get(dailyPrice.assetId);
    if (!asset) continue;
    const date = dailyPrice.date.toISOString().slice(0, 10);
    const snapshot = byDate.get(date) ?? { marketPrices: {}, hasStalePrices: false };
    snapshot.marketPrices[asset.symbol] = serializeDecimal(dailyPrice.price);
    snapshot.hasStalePrices ||= dailyPrice.isStaleAtCapture;
    byDate.set(date, snapshot);
  }

  return [...byDate.entries()]
    .map(([date, snapshot]) => ({ date, ...snapshot }))
    .sort((left, right) => left.date.localeCompare(right.date));
}
