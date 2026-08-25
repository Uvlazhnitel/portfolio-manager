import { serializeDecimal } from "@/lib/db/decimal";
import { BaseCurrencyMarketDataProvider } from "@/features/market-data/providers/base-currency";
import { CoinGeckoMarketDataProvider } from "@/features/market-data/providers/coingecko";
import { ManualMarketDataProvider } from "@/features/market-data/providers/manual";
import {
  MarketDataRepository,
  type CachedPriceRecord,
  type MarketDataStore,
} from "@/features/market-data/repository";
import type {
  MarketDataAsset,
  MarketDataProvider,
  MarketDataSnapshot,
  MarketPrice,
  ResolvedMarketPrice,
} from "@/features/market-data/types";

export const MARKET_PRICE_CACHE_TTL_MS = 5 * 60 * 1_000;
export const MARKET_PRICE_STALE_AFTER_MS = 15 * 60 * 1_000;
export const MARKET_PRICE_REFRESH_COOLDOWN_MS = 60 * 1_000;

const refreshAttempts = new Map<string, number>();
const inFlightRefreshes = new Map<string, Promise<MarketDataSnapshot>>();

export class MarketDataService {
  private readonly providers: MarketDataProvider[];

  constructor(
    private readonly store: MarketDataStore = new MarketDataRepository(),
    providers?: MarketDataProvider[],
  ) {
    this.providers = providers ?? [
      new BaseCurrencyMarketDataProvider(),
      new CoinGeckoMarketDataProvider(),
      new ManualMarketDataProvider(async (currency) => {
        const records = await this.store.listManualPrices(currency);
        return records.map((record) => ({
          assetId: record.assetId,
          currency: record.currency,
          price: serializeDecimal(record.price),
          unit: record.unit,
          updatedAt: record.updatedAt,
        }));
      }),
    ];
  }

  async getCurrentPrices(input: {
    assets: MarketDataAsset[];
    baseCurrency?: string;
    forceRefresh?: boolean;
    now?: Date;
  }): Promise<MarketDataSnapshot> {
    const baseCurrency = input.baseCurrency ?? "EUR";
    const now = input.now ?? new Date();
    const refreshKey = buildRefreshKey(baseCurrency, input.assets);
    const cache = await this.store.listCachedPrices(input.assets.map((asset) => asset.id), baseCurrency);
    const cacheByAsset = new Map(cache.map((price) => [price.assetId, price]));
    const needsRefresh = input.assets.filter((asset) => {
      const cached = cacheByAsset.get(asset.id);
      return input.forceRefresh || !cached || now.getTime() - cached.fetchedAt.getTime() >= MARKET_PRICE_CACHE_TTL_MS;
    });

    if (needsRefresh.length === 0) {
      return buildSnapshot(input.assets, cache, now, false, null, null);
    }

    const lastAttempt = refreshAttempts.get(refreshKey);
    if (lastAttempt && now.getTime() - lastAttempt < MARKET_PRICE_REFRESH_COOLDOWN_MS) {
      return buildSnapshot(
        input.assets,
        cache,
        now,
        false,
        new Date(lastAttempt + MARKET_PRICE_REFRESH_COOLDOWN_MS).toISOString(),
        null,
      );
    }

    const existingRefresh = inFlightRefreshes.get(refreshKey);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refresh = this.refresh({
      assets: input.assets,
      baseCurrency,
      now,
      previousCache: cache,
      needsRefresh,
      refreshKey,
    }).finally(() => inFlightRefreshes.delete(refreshKey));
    inFlightRefreshes.set(refreshKey, refresh);
    return refresh;
  }

  private async refresh(input: {
    assets: MarketDataAsset[];
    baseCurrency: string;
    now: Date;
    previousCache: CachedPriceRecord[];
    needsRefresh: MarketDataAsset[];
    refreshKey: string;
  }) {
    refreshAttempts.set(input.refreshKey, input.now.getTime());
    const cachedByAsset = new Map(input.previousCache.map((price) => [price.assetId, price]));
    const refreshedByAsset = new Map<string, MarketPrice>();
    const warnings: string[] = [];

    for (const provider of this.providers) {
      const remainingAssets = input.needsRefresh.filter((asset) => {
        if (refreshedByAsset.has(asset.id)) {
          return false;
        }

        if (provider.name === "MANUAL" && asset.externalId && cachedByAsset.has(asset.id)) {
          return false;
        }

        return true;
      });

      if (remainingAssets.length === 0) {
        continue;
      }

      try {
        const prices = await provider.getCurrentPrices({
          assets: remainingAssets,
          baseCurrency: input.baseCurrency,
        });
        for (const price of prices) {
          refreshedByAsset.set(price.assetId, price);
        }
      } catch (error) {
        void error;
        warnings.push(`${provider.name} market data is temporarily unavailable.`);
      }
    }

    const refreshedPrices = [...refreshedByAsset.values()];
    if (refreshedPrices.length > 0) {
      await this.store.saveCachedPrices(refreshedPrices, input.now);
    }

    const refreshedCache = await this.store.listCachedPrices(
      input.assets.map((asset) => asset.id),
      input.baseCurrency,
    );

    return buildSnapshot(
      input.assets,
      refreshedCache,
      input.now,
      refreshedPrices.length > 0,
      new Date(input.now.getTime() + MARKET_PRICE_REFRESH_COOLDOWN_MS).toISOString(),
      warnings.length > 0 ? warnings.join(" ") : null,
    );
  }
}

function buildRefreshKey(baseCurrency: string, assets: MarketDataAsset[]) {
  return `${baseCurrency.toUpperCase()}:${assets.map((asset) => asset.id).sort().join(",")}`;
}

function buildSnapshot(
  assets: MarketDataAsset[],
  cachedPrices: CachedPriceRecord[],
  now: Date,
  wasRefreshed: boolean,
  refreshBlockedUntil: string | null,
  warning: string | null,
): MarketDataSnapshot {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const prices = cachedPrices.flatMap<ResolvedMarketPrice>((cached) => {
    const asset = assetsById.get(cached.assetId);
    if (!asset) {
      return [];
    }

    return [{
      assetId: cached.assetId,
      symbol: asset.symbol,
      price: serializeDecimal(cached.price),
      currency: cached.currency,
      timestamp: cached.timestamp,
      fetchedAt: cached.fetchedAt,
      source: cached.source,
      isStale: now.getTime() - cached.timestamp.getTime() >= MARKET_PRICE_STALE_AFTER_MS,
    }];
  });
  const pricedAssetIds = new Set(prices.map((price) => price.assetId));
  const latestTimestamp = prices.reduce<Date | null>((latest, price) => {
    return !latest || price.timestamp > latest ? price.timestamp : latest;
  }, null);

  return {
    prices,
    unavailableAssetIds: assets.filter((asset) => !pricedAssetIds.has(asset.id)).map((asset) => asset.id),
    lastUpdated: latestTimestamp?.toISOString() ?? null,
    hasStalePrices: prices.some((price) => price.isStale),
    wasRefreshed,
    refreshBlockedUntil,
    warning,
  };
}

export function toEngineMarketPrices(snapshot: MarketDataSnapshot) {
  return Object.fromEntries(snapshot.prices.map((price) => [price.symbol, price.price]));
}

export function resetMarketDataRuntimeCache() {
  refreshAttempts.clear();
  inFlightRefreshes.clear();
}

export const resetMarketDataRuntimeCacheForTests = resetMarketDataRuntimeCache;
