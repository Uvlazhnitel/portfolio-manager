import type { AssetClass } from "@prisma/client";
import {
  buildContributionProjection,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  calculateStrategyAlignment,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  type AllocationStatus,
  type ContributionProjection,
  type StrategyAlignment,
} from "@/features/portfolio-engine";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal, serializeNullableDecimal } from "@/lib/db/decimal";

export type DashboardReadModel = {
  valuation: {
    totalValue: string;
    totalUnrealizedPnl: string | null;
    currency: string;
    isPartial: boolean;
    missingPriceSymbols: string[];
    lastUpdated: string | null;
    hasStalePrices: boolean;
    warning: string | null;
  };
  alignment: StrategyAlignment;
  allocation: Array<{
    assetClass: AssetClass;
    value: string;
    currentPercent: string;
    targetPercent: string;
    minPercent: string;
    maxPercent: string;
    status: AllocationStatus;
  }>;
  contribution: {
    amount: string;
    projection: ContributionProjection | null;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    symbol: string;
    assetName: string;
    accountName: string;
    quantity: string;
    pricePerUnit: string | null;
    currency: string;
    executedAt: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    value: string;
    isPartial: boolean;
  }>;
  strategyStatus: {
    state: "EMPTY" | "STAY_CONSISTENT" | "NEEDS_ATTENTION";
    strategyName: string | null;
    warnings: Array<{
      code: string;
      assetClass: AssetClass;
      currentPercent: string;
      limitPercent: string;
    }>;
  };
};

export async function getDashboardReadModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  contributionPlanRepository = new ContributionPlanRepository(),
  marketDataService = new MarketDataService(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  contributionPlanRepository?: ContributionPlanRepository;
  marketDataService?: MarketDataService;
} = {}): Promise<DashboardReadModel> {
  const [assets, accounts, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listAccounts(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const baseCurrency = strategy?.baseCurrency ?? "EUR";
  const [marketData, savedPlan] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency }),
    strategy ? contributionPlanRepository.findByStrategyId(strategy.id) : null,
  ]);
  const portfolio = calculatePortfolio({ assets, transactions, marketPrices: toEngineMarketPrices(marketData) });
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency });
  const comparisons = strategy ? compareAllocationToStrategy(portfolio, strategy.allocations) : [];
  const warnings = strategy ? evaluateStrategyCompliance(portfolio, strategy.allocations) : [];
  const alignment = calculateStrategyAlignment({
    comparisons,
    pricedHoldings: analytics.priceCoverage.pricedHoldings,
    totalHoldings: analytics.priceCoverage.totalHoldings,
  });
  const allocationByClass = new Map(portfolio.allocation.map((item) => [item.assetClass, item]));
  const accountAnalytics = new Map(analytics.accounts.map((account) => [account.accountId, account]));
  const contributionAmount = savedPlan ? serializeDecimal(savedPlan.contributionAmount) : "";
  const contributionProjection = strategy && contributionAmount && contributionAmount !== "0"
    ? buildContributionProjection({ portfolio, strategy: strategy.allocations, contributionAmount })
    : null;
  const hasHoldings = analytics.priceCoverage.totalHoldings > 0;

  return {
    valuation: {
      totalValue: portfolio.totalValue,
      totalUnrealizedPnl: analytics.totalUnrealizedPnl,
      currency: baseCurrency,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
    },
    alignment,
    allocation: comparisons.map((comparison) => ({
      assetClass: comparison.assetClass,
      value: allocationByClass.get(comparison.assetClass)?.value ?? "0.00",
      currentPercent: comparison.currentPercent,
      targetPercent: comparison.targetPercent,
      minPercent: comparison.minPercent,
      maxPercent: comparison.maxPercent,
      status: comparison.status,
    })),
    contribution: { amount: contributionAmount, projection: contributionProjection },
    recentActivity: transactions.slice(0, 5).map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      symbol: transaction.asset.symbol,
      assetName: transaction.asset.name,
      accountName: transaction.account.name,
      quantity: serializeDecimal(transaction.quantity),
      pricePerUnit: serializeNullableDecimal(transaction.pricePerUnit),
      currency: transaction.currency,
      executedAt: transaction.executedAt.toISOString(),
    })),
    accounts: accounts.map((account) => {
      const valued = accountAnalytics.get(account.id);
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        value: valued?.value ?? "0.00",
        isPartial: valued?.isPartial ?? false,
      };
    }),
    strategyStatus: {
      state: !hasHoldings ? "EMPTY" : warnings.length > 0 ? "NEEDS_ATTENTION" : "STAY_CONSISTENT",
      strategyName: strategy?.name ?? null,
      warnings: warnings.map((warning) => ({
        code: warning.code,
        assetClass: warning.assetClass,
        currentPercent: warning.currentPercent,
        limitPercent: warning.limitPercent,
      })),
    },
  };
}
