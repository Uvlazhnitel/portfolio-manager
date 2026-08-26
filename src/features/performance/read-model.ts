import {
  calculateHistoricalPerformance,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  type HistoricalMarketSnapshot,
  type PortfolioPerformancePoint,
} from "@/features/portfolio-engine";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export type PerformanceReadModel = {
  currency: string;
  summary: {
    portfolioValue: string;
    netInvested: string;
    investmentGain: string | null;
    simpleReturnPercent: string | null;
    netContributed: string;
    externalContributions: string | null;
    externalWithdrawals: string | null;
    isCostBasisPartial: boolean;
    missingCostBasisSymbols: string[];
    isExternalCashflowPartial: boolean;
    missingExternalCashflowSymbols: string[];
    isPartial: boolean;
    missingPriceSymbols: string[];
    hasStalePrices: boolean;
  };
  history: PortfolioPerformancePoint[];
  trackingStartedAt: string | null;
  incompleteDates: number;
  staleDates: number;
  historicalMissingPriceSymbols: string[];
  historicalMissingCostBasisSymbols: string[];
};

export async function getPerformanceReadModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
  dailyPriceStore = new DailyMarketPriceRepository(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
  dailyPriceStore?: DailyMarketPriceStore;
} = {}): Promise<PerformanceReadModel> {
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const currency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [marketData, dailyPrices] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency: currency }),
    dailyPriceStore.listDailyPrices(currency),
  ]);
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: currency });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotsByDate = new Map<string, { marketPrices: Record<string, string>; hasStalePrices: boolean }>();

  for (const dailyPrice of dailyPrices) {
    const asset = assetById.get(dailyPrice.assetId);
    if (!asset) continue;
    const date = dailyPrice.date.toISOString().slice(0, 10);
    const snapshot = snapshotsByDate.get(date) ?? { marketPrices: {}, hasStalePrices: false };
    snapshot.marketPrices[asset.symbol] = serializeDecimal(dailyPrice.price);
    snapshot.hasStalePrices ||= dailyPrice.isStaleAtCapture;
    snapshotsByDate.set(date, snapshot);
  }

  const snapshots: HistoricalMarketSnapshot[] = [...snapshotsByDate.entries()]
    .map(([date, snapshot]) => ({ date, ...snapshot }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const history = calculateHistoricalPerformance({
    assets,
    transactions,
    baseCurrency: currency,
    snapshots,
  });
  const historicalMissingPriceSymbols = [...new Set(
    history.flatMap((point) => point.missingPriceSymbols),
  )].sort();
  const historicalMissingCostBasisSymbols = [...new Set(
    history.flatMap((point) => point.missingCostBasisSymbols),
  )].sort();

  return {
    currency,
    summary: {
      portfolioValue: portfolio.totalValue,
      netInvested: analytics.netInvested ?? "0.00",
      investmentGain: analytics.investmentGain,
      simpleReturnPercent: analytics.simpleReturnPercent,
      netContributed: analytics.netContributed,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      isCostBasisPartial: analytics.isCostBasisPartial,
      missingCostBasisSymbols: analytics.missingCostBasisSymbols,
      isExternalCashflowPartial: analytics.isExternalCashflowPartial,
      missingExternalCashflowSymbols: analytics.missingExternalCashflowSymbols,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      hasStalePrices: marketData.hasStalePrices,
    },
    history,
    trackingStartedAt: history[0]?.date ?? null,
    incompleteDates: history.filter((point) => !point.isComplete).length,
    staleDates: history.filter((point) => point.hasStalePrices).length,
    historicalMissingPriceSymbols,
    historicalMissingCostBasisSymbols,
  };
}
