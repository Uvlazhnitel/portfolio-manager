import { AssetType, PortfolioRuleType } from "@prisma/client";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import {
  buildContributionProjection,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  calculatePortfolioRisk,
  compareAllocationToStrategy,
  evaluateStrategyCompliance,
  type MarketPrices,
  type PortfolioRiskSnapshot,
} from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import { formatTroyOunces, gramsToTroyOunces } from "@/features/market-data/gold";
import { riskThresholdsFromRules } from "@/features/risk/config";

type Assets = Awaited<ReturnType<PortfolioRepository["listAssets"]>>;
type Accounts = Awaited<ReturnType<PortfolioRepository["listAccounts"]>>;
type Transactions = Awaited<ReturnType<PortfolioRepository["listTransactions"]>>;
type Strategy = Awaited<ReturnType<StrategyRepository["findActiveStrategy"]>>;

export type PortfolioAssistantContext = {
  baseCurrency: string;
  valuation: {
    totalPortfolioValue: string;
    totalUnrealizedPnl: string | null;
    investmentGain: string | null;
    netInvested: string;
    netContributed: string;
    externalContributions: string | null;
    externalWithdrawals: string | null;
    trackedCapital: string;
    trackedCapitalReturnPercent: string | null;
    openingBasis: string;
    giftTrackingBasis: string;
    isCostBasisPartial: boolean;
    missingCostBasisSymbols: string[];
    isExternalCashflowPartial: boolean;
    isPartial: boolean;
    missingPriceSymbols: string[];
    priceCoveragePercent: string;
  };
  allocation: Array<{
    assetClass: string;
    value: string;
    currentPercent: string;
    targetPercent: string;
    minPercent: string;
    maxPercent: string;
    status: string;
  }>;
  strategy: {
    name: string;
    objective: string;
    allocations: Array<{
      assetClass: string;
      targetPercent: string;
      minPercent: string;
      maxPercent: string;
      assetTargets: Array<{ symbol: string; targetPercent: string }>;
    }>;
    rules: Array<{ type: string; enabled: boolean; config: unknown }>;
  } | null;
  violations: Array<{
    code: string;
    assetClass: string;
    currentPercent: string;
    limitPercent: string;
  }>;
  holdings: Array<{
    symbol: string;
    assetClass: string;
    quantity: string;
    quantityUnit: "ASSET_UNIT" | "TROY_OUNCE";
    currentValue: string | null;
  }>;
  accounts: Array<{ name: string; type: string; currentValue: string; isPartial: boolean }>;
  latestContributionRecommendation: {
    contributionAmount: string;
    allocations: Array<{ assetClass: string; amount: string; percentOfContribution: string }>;
    assetRecommendations: Array<{
      symbol: string;
      name: string;
      assetClass: string;
      amount: string;
      percentOfContribution: string;
      targetPercentOfClass: string;
      effectiveTargetPercent: string;
    }>;
    warnings: Array<{ code: string; assetClass: string; currentPercent: string; limitPercent: string }>;
    reasons: ReturnType<typeof buildContributionProjection>["reasons"];
    dataQuality: { isPartial: boolean; missingPriceSymbols: string[] };
  } | null;
  marketData: { timestamp: string | null; hasStalePrices: boolean };
  risk: PortfolioRiskSnapshot;
};

export type AssistantPortfolioRuntime = {
  assets: Assets;
  accounts: Accounts;
  transactions: Transactions;
  strategy: Strategy;
  marketPrices: MarketPrices;
  portfolio: ReturnType<typeof calculatePortfolio>;
  riskThresholds: ReturnType<typeof riskThresholdsFromRules>;
  hasStalePrices: boolean;
  context: PortfolioAssistantContext;
};

type AssistantContextDependencies = {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  contributionPlanRepository?: ContributionPlanRepository;
  marketDataService?: MarketDataService;
};

export async function buildPortfolioAssistantContext(dependencies: AssistantContextDependencies = {}) {
  return (await loadAssistantPortfolioRuntime(dependencies)).context;
}

export async function loadAssistantPortfolioRuntime({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  contributionPlanRepository = new ContributionPlanRepository(),
  marketDataService = new MarketDataService(),
}: AssistantContextDependencies = {}): Promise<AssistantPortfolioRuntime> {
  const [assets, accounts, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listAccounts(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [marketData, savedPlan] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency }),
    strategy ? contributionPlanRepository.findByStrategyId(strategy.id) : null,
  ]);
  const marketPrices = toEngineMarketPrices(marketData);
  const portfolio = calculatePortfolio({ assets, transactions, marketPrices });
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency });
  const comparisons = strategy ? compareAllocationToStrategy(portfolio, strategy.allocations) : [];
  const warnings = strategy ? evaluateStrategyCompliance(portfolio, strategy.allocations) : [];
  const riskThresholds = riskThresholdsFromRules(strategy?.portfolioRules ?? []);
  const risk = calculatePortfolioRisk({
    portfolio,
    assets,
    accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, custodian: account.custodian ? { id: account.custodian.id, name: account.custodian.name, category: account.custodian.category } : null })),
    strategy: strategy?.allocations ?? null,
    thresholds: riskThresholds,
    hasStalePrices: marketData.hasStalePrices,
  });
  const allocationValues = new Map(portfolio.allocation.map((allocation) => [allocation.assetClass, allocation.value]));
  const accountAnalytics = new Map(analytics.accounts.map((account) => [account.accountId, account]));
  const missingSymbols = new Set(portfolio.missingPriceSymbols);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const quantityByAsset = new Map<string, ReturnType<typeof decimal>>();
  const valueByAsset = new Map<string, ReturnType<typeof decimal>>();

  for (const holding of portfolio.holdings) {
    quantityByAsset.set(holding.assetId, (quantityByAsset.get(holding.assetId) ?? ZERO).plus(decimal(holding.quantity)));
  }
  for (const holding of portfolio.valuedHoldings) {
    valueByAsset.set(holding.assetId, (valueByAsset.get(holding.assetId) ?? ZERO).plus(decimal(holding.value)));
  }

  let recommendation: ReturnType<typeof buildContributionProjection> | null = null;
  if (strategy && savedPlan && decimal(savedPlan.contributionAmount).greaterThan(ZERO)) {
    try {
      recommendation = buildContributionProjection({
        portfolio,
        assets,
        strategy: strategy.allocations,
        contributionAmount: serializeDecimal(savedPlan.contributionAmount),
      });
    } catch {
      recommendation = null;
    }
  }

  const context: PortfolioAssistantContext = {
    baseCurrency,
    valuation: {
      totalPortfolioValue: portfolio.totalValue,
      totalUnrealizedPnl: analytics.totalUnrealizedPnl,
      investmentGain: analytics.investmentGain,
      netInvested: analytics.netInvested,
      netContributed: analytics.netContributed,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      trackedCapital: analytics.trackedCapital,
      trackedCapitalReturnPercent: analytics.trackedCapitalReturnPercent,
      openingBasis: analytics.openingBasis,
      giftTrackingBasis: analytics.giftTrackingBasis,
      isCostBasisPartial: analytics.isCostBasisPartial,
      missingCostBasisSymbols: analytics.missingCostBasisSymbols,
      isExternalCashflowPartial: analytics.isExternalCashflowPartial,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      priceCoveragePercent: analytics.priceCoverage.percent,
    },
    allocation: comparisons.map((comparison) => ({
      assetClass: comparison.assetClass,
      value: allocationValues.get(comparison.assetClass) ?? "0.00",
      currentPercent: comparison.currentPercent,
      targetPercent: comparison.targetPercent,
      minPercent: comparison.minPercent,
      maxPercent: comparison.maxPercent,
      status: comparison.status,
    })),
    strategy: strategy
      ? {
          name: strategy.name,
          objective: strategy.objective,
          allocations: strategy.allocations.map((allocation) => ({
            assetClass: allocation.assetClass,
            targetPercent: serializeDecimal(allocation.targetPercent),
            minPercent: serializeDecimal(allocation.minPercent),
            maxPercent: serializeDecimal(allocation.maxPercent),
            assetTargets: allocation.assetAllocations.map((assetAllocation) => ({
              symbol: assetAllocation.asset.symbol,
              targetPercent: serializeDecimal(assetAllocation.targetPercent),
            })),
          })),
          rules: strategy.portfolioRules
            .filter((rule) => rule.type !== PortfolioRuleType.CRYPTO_MAX_ALLOCATION)
            .map((rule) => ({ type: rule.type, enabled: rule.enabled, config: rule.config })),
        }
      : null,
    violations: warnings.map((warning) => ({
      code: warning.code,
      assetClass: warning.assetClass,
      currentPercent: warning.currentPercent,
      limitPercent: warning.limitPercent,
    })),
    holdings: [...quantityByAsset.entries()].map(([assetId, quantity]) => {
      const asset = assetById.get(assetId);
      const hasPrice = asset ? !missingSymbols.has(asset.symbol) : false;
      return {
        symbol: asset?.symbol ?? "UNKNOWN",
        assetClass: asset?.assetClass ?? "OTHER",
        quantity: asset?.assetType === AssetType.PHYSICAL_GOLD
          ? formatTroyOunces(gramsToTroyOunces(quantity))
          : quantity.toString(),
        quantityUnit: asset?.assetType === AssetType.PHYSICAL_GOLD ? "TROY_OUNCE" : "ASSET_UNIT",
        currentValue: hasPrice ? (valueByAsset.get(assetId) ?? ZERO).toFixed(2) : null,
      };
    }),
    accounts: accounts.map((account) => {
      const analyticsAccount = accountAnalytics.get(account.id);
      return {
        name: account.name,
        type: account.type,
        currentValue: analyticsAccount?.value ?? "0.00",
        isPartial: analyticsAccount?.isPartial ?? false,
      };
    }),
    latestContributionRecommendation: recommendation
      ? {
          contributionAmount: recommendation.plan.contributionAmount,
          allocations: recommendation.plan.allocations,
          assetRecommendations: recommendation.plan.assetRecommendations,
          warnings: recommendation.warnings.map((warning) => ({
            code: warning.code,
            assetClass: warning.assetClass,
            currentPercent: warning.currentPercent,
            limitPercent: warning.limitPercent,
          })),
          reasons: recommendation.reasons,
          dataQuality: {
            isPartial: recommendation.plan.before.missingPriceSymbols.length > 0 || recommendation.plan.projectedAfter.missingPriceSymbols.length > 0,
            missingPriceSymbols: [...new Set([
              ...recommendation.plan.before.missingPriceSymbols,
              ...recommendation.plan.projectedAfter.missingPriceSymbols,
            ])].sort(),
          },
        }
      : null,
    marketData: { timestamp: marketData.lastUpdated, hasStalePrices: marketData.hasStalePrices },
    risk,
  };

  return { assets, accounts, transactions, strategy, marketPrices, portfolio, riskThresholds, hasStalePrices: marketData.hasStalePrices, context };
}
