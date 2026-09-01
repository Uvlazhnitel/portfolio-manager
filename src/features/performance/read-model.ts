import {
  calculateAdvancedPerformance,
  calculateHistoricalPerformance,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  type AdvancedPerformance,
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
    trackedCapital: string;
    trackedCapitalReturnPercent: string | null;
    netContributed: string;
    externalContributions: string | null;
    externalWithdrawals: string | null;
    openingBasis: string;
    giftTrackingBasis: string;
    internalTradeFees: string;
    isNetInvestedPartial: boolean;
    missingNetInvestedSymbols: string[];
    coveredSymbols: string[];
    openingBasisUnknownSymbols: string[];
    performanceExclusions: PortfolioPerformancePoint["performanceExclusions"];
    isCostBasisPartial: boolean;
    missingCostBasisSymbols: string[];
    isExternalCashflowPartial: boolean;
    missingExternalCashflowSymbols: string[];
    isPartial: boolean;
    missingPriceSymbols: string[];
    hasStalePrices: boolean;
  };
  history: PortfolioPerformancePoint[];
  advanced: AdvancedPerformance;
  benchmark: {
    strategyId: string | null;
    selectedAssetId: string | null;
    selectedSymbol: string | null;
    selectedName: string | null;
    options: Array<{ id: string; symbol: string; name: string }>;
  };
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
  now = new Date(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
  dailyPriceStore?: DailyMarketPriceStore;
  now?: Date;
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
  const currentDate = now.toISOString().slice(0, 10);
  const benchmarkAsset = strategy?.benchmarkAsset ?? null;
  const benchmarkDailyPrices = benchmarkAsset
    ? dailyPrices
      .filter((price) => price.assetId === benchmarkAsset.id)
      .map((price) => ({
        date: price.date.toISOString().slice(0, 10),
        price: serializeDecimal(price.price),
        hasStalePrices: price.isStaleAtCapture,
      }))
    : [];
  const currentBenchmarkPrice = benchmarkAsset
    ? marketData.prices.find((price) => price.assetId === benchmarkAsset.id)
    : null;
  const advanced = calculateAdvancedPerformance({
    assets,
    transactions,
    baseCurrency: currency,
    history: history.map((point) => ({
      date: point.date,
      portfolioValue: point.portfolioValue,
      investmentGain: point.investmentGain,
      externalContributions: point.externalContributions,
      externalWithdrawals: point.externalWithdrawals,
      performanceExclusions: point.performanceExclusions,
      isComplete: point.isComplete,
      hasStalePrices: point.hasStalePrices,
    })),
    current: {
      date: currentDate,
      portfolioValue: portfolio.missingPriceSymbols.length === 0 ? portfolio.totalValue : null,
      investmentGain: analytics.investmentGain,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      performanceExclusions: analytics.performanceExclusions,
      isComplete: portfolio.missingPriceSymbols.length === 0,
      hasStalePrices: marketData.hasStalePrices,
    },
    asOf: now,
    benchmark: benchmarkAsset ? {
      assetId: benchmarkAsset.id,
      observations: benchmarkDailyPrices,
      current: currentBenchmarkPrice ? {
        date: currentDate,
        price: currentBenchmarkPrice.price,
        hasStalePrices: currentBenchmarkPrice.isStale,
      } : null,
    } : null,
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
      trackedCapital: analytics.trackedCapital,
      trackedCapitalReturnPercent: analytics.trackedCapitalReturnPercent,
      netContributed: analytics.netContributed,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      openingBasis: analytics.openingBasis,
      giftTrackingBasis: analytics.giftTrackingBasis,
      internalTradeFees: analytics.internalTradeFees,
      isNetInvestedPartial: analytics.isNetInvestedPartial,
      missingNetInvestedSymbols: analytics.missingNetInvestedSymbols,
      coveredSymbols: analytics.coveredSymbols,
      openingBasisUnknownSymbols: analytics.openingBasisUnknownSymbols,
      performanceExclusions: analytics.performanceExclusions,
      isCostBasisPartial: analytics.isCostBasisPartial,
      missingCostBasisSymbols: analytics.missingCostBasisSymbols,
      isExternalCashflowPartial: analytics.isExternalCashflowPartial,
      missingExternalCashflowSymbols: analytics.missingExternalCashflowSymbols,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      hasStalePrices: marketData.hasStalePrices,
    },
    history,
    advanced,
    benchmark: {
      strategyId: strategy?.id ?? null,
      selectedAssetId: benchmarkAsset?.id ?? null,
      selectedSymbol: benchmarkAsset?.symbol ?? null,
      selectedName: benchmarkAsset?.name ?? null,
      options: assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name })),
    },
    trackingStartedAt: history[0]?.date ?? null,
    incompleteDates: history.filter((point) => !point.isComplete).length,
    staleDates: history.filter((point) => point.hasStalePrices).length,
    historicalMissingPriceSymbols,
    historicalMissingCostBasisSymbols,
  };
}
