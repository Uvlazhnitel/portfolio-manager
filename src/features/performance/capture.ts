import { MarketDataService } from "@/features/market-data/service";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export type DailyCaptureResult = {
  date: string;
  capturedPrices: number;
  unavailableAssetIds: string[];
  hasStalePrices: boolean;
  warning: string | null;
};

export async function captureDailyMarketPrices({
  now = new Date(),
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
  dailyPriceStore = new DailyMarketPriceRepository(),
}: {
  now?: Date;
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
  dailyPriceStore?: DailyMarketPriceStore;
} = {}): Promise<DailyCaptureResult> {
  const [assets, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    strategyRepository.findActiveStrategy(),
  ]);

  if (assets.length === 0) {
    throw new Error("Daily price capture requires at least one portfolio asset.");
  }

  const currency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const snapshot = await marketDataService.getCurrentPrices({
    assets,
    baseCurrency: currency,
    forceRefresh: true,
    now,
  });
  const date = startOfUtcDay(now);

  await dailyPriceStore.saveDailyPrices(snapshot.prices.map((price) => ({
    assetId: price.assetId,
    currency: price.currency,
    date,
    price: price.price,
    source: price.source,
    quoteTimestamp: price.timestamp,
    capturedAt: now,
    isStaleAtCapture: price.isStale,
  })));

  return {
    date: date.toISOString().slice(0, 10),
    capturedPrices: snapshot.prices.length,
    unavailableAssetIds: snapshot.unavailableAssetIds,
    hasStalePrices: snapshot.hasStalePrices,
    warning: snapshot.warning,
  };
}

export function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
