import {
  calculateHistoricalPerformance,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  calculateTrackedPerformance,
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
    netContributed: string | null;
    investmentGain: string | null;
    simpleReturnPercent: string | null;
    isPartial: boolean;
    missingPriceSymbols: string[];
    hasStalePrices: boolean;
  };
  history: PortfolioPerformancePoint[];
  trackingStartedAt: string | null;
  incompleteDates: number;
  staleDates: number;
  historicalMissingPriceSymbols: string[];
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
  const trackedPerformance = snapshots[0]
    ? calculateTrackedPerformance({
        assets,
        transactions,
        baseCurrency: currency,
        openingSnapshot: snapshots[0],
        currentMarketPrices: toEngineMarketPrices(marketData),
      })
    : {
        netContributed: analytics.netInvested,
        investmentGain: analytics.investmentGain,
        simpleReturnPercent: analytics.simpleReturnPercent,
      };
  const historicalMissingPriceSymbols = [...new Set(
    history.flatMap((point) => point.missingPriceSymbols),
  )].sort();

  return {
    currency,
    summary: {
      portfolioValue: portfolio.totalValue,
      netContributed: trackedPerformance.netContributed,
      investmentGain: trackedPerformance.investmentGain,
      simpleReturnPercent: trackedPerformance.simpleReturnPercent,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      hasStalePrices: marketData.hasStalePrices,
    },
    history,
    trackingStartedAt: history[0]?.date ?? null,
    incompleteDates: history.filter((point) => !point.isComplete).length,
    staleDates: history.filter((point) => point.hasStalePrices).length,
    historicalMissingPriceSymbols,
  };
}
