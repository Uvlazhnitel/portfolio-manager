import { compareAllocationToStrategy, calculatePortfolio } from "@/features/portfolio-engine";
import { decimal } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";

export async function getDashboardReadModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
} = {}) {
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const baseCurrency = strategy?.baseCurrency ?? "EUR";
  const marketData = await marketDataService.getCurrentPrices({ assets, baseCurrency });
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const comparisons = strategy
    ? compareAllocationToStrategy(portfolio, strategy.allocations)
    : [];
  const strongestUnderweight = [...comparisons]
    .filter((comparison) => comparison.status === "UNDERWEIGHT")
    .sort((left, right) => decimal(left.driftFromTarget).cmp(decimal(right.driftFromTarget)))[0];

  return {
    totalValue: portfolio.totalValue,
    baseCurrency,
    isPartial: portfolio.missingPriceSymbols.length > 0,
    missingPriceSymbols: portfolio.missingPriceSymbols,
    lastUpdated: marketData.lastUpdated,
    hasStalePrices: marketData.hasStalePrices,
    warning: marketData.warning,
    comparisons,
    inRangeCount: comparisons.filter((comparison) => comparison.status === "IN_RANGE").length,
    suggestedAssetClass: strongestUnderweight?.assetClass ?? null,
  };
}
