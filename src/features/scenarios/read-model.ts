import { calculatePortfolio } from "@/features/portfolio-engine";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { simulateMarketScenario, simulateTransactionScenario } from "@/features/scenarios/engine";
import type { MarketScenarioFormInput, TransactionScenarioFormInput } from "@/features/scenarios/validation";
import { marketScenarioSchema, transactionScenarioSchema } from "@/features/scenarios/validation";
import { StrategyRepository } from "@/features/strategy/repository";

export type ScenariosPageModel = {
  assets: Array<{
    id: string;
    symbol: string;
    name: string;
    assetClass: string;
    hasPrice: boolean;
  }>;
  currency: string;
  currentValue: string;
  isPartial: boolean;
  missingPriceSymbols: string[];
  lastUpdated: string | null;
  hasStrategy: boolean;
};

type ScenarioDependencies = {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
};

export async function getScenariosPageModel(dependencies: ScenarioDependencies = {}): Promise<ScenariosPageModel> {
  const context = await loadScenarioContext(dependencies);
  const pricedSymbols = new Set(Object.keys(context.marketPrices));

  return {
    assets: context.assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      hasPrice: pricedSymbols.has(asset.symbol),
    })),
    currency: context.strategy?.baseCurrency ?? "EUR",
    currentValue: context.portfolio.totalValue,
    isPartial: context.portfolio.missingPriceSymbols.length > 0,
    missingPriceSymbols: context.portfolio.missingPriceSymbols,
    lastUpdated: context.marketData.lastUpdated,
    hasStrategy: Boolean(context.strategy),
  };
}

export async function previewTransactionScenario(
  input: TransactionScenarioFormInput,
  dependencies: ScenarioDependencies = {},
) {
  const parsed = transactionScenarioSchema.parse(input);
  const context = await loadScenarioContext(dependencies);
  if (!context.strategy) throw new Error("Create an investment strategy before running this scenario.");
  return simulateTransactionScenario({
    assets: context.assets,
    transactions: context.transactions,
    marketPrices: context.marketPrices,
    strategy: context.strategy.allocations,
    ...parsed,
  });
}

export async function previewMarketScenario(
  input: MarketScenarioFormInput,
  dependencies: ScenarioDependencies = {},
) {
  const parsed = marketScenarioSchema.parse(input);
  const context = await loadScenarioContext(dependencies);
  return simulateMarketScenario({
    assets: context.assets,
    transactions: context.transactions,
    marketPrices: context.marketPrices,
    shocks: parsed.shocks,
  });
}

async function loadScenarioContext({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
}: ScenarioDependencies) {
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const marketData = await marketDataService.getCurrentPrices({
    assets,
    baseCurrency: strategy?.baseCurrency ?? "EUR",
  });
  const marketPrices = toEngineMarketPrices(marketData);
  return {
    assets,
    transactions,
    strategy,
    marketData,
    marketPrices,
    portfolio: calculatePortfolio({ assets, transactions, marketPrices }),
  };
}
