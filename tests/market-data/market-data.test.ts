import { AssetType, MarketPriceUnit, Prisma, type CachedMarketPrice } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { goldPricePerGram, GRAMS_PER_TROY_OUNCE } from "@/features/market-data/gold";
import { BaseCurrencyMarketDataProvider } from "@/features/market-data/providers/base-currency";
import { CoinGeckoMarketDataProvider } from "@/features/market-data/providers/coingecko";
import { ManualMarketDataProvider, normalizeManualPrice } from "@/features/market-data/providers/manual";
import type { MarketDataStore } from "@/features/market-data/repository";
import {
  MARKET_PRICE_CACHE_TTL_MS,
  MarketDataService,
  resetMarketDataRuntimeCacheForTests,
} from "@/features/market-data/service";
import type { MarketDataAsset, MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const now = new Date("2026-08-24T20:00:00.000Z");
const btc: MarketDataAsset = {
  id: "btc-id",
  symbol: "BTC",
  name: "Bitcoin",
  assetType: AssetType.CRYPTO,
  currency: "BTC",
  externalId: "bitcoin",
};

beforeEach(() => resetMarketDataRuntimeCacheForTests());

describe("market data providers", () => {
  it("converts troy ounces to grams without using regular ounces", () => {
    expect(GRAMS_PER_TROY_OUNCE).toBe("31.1034768");
    expect(goldPricePerGram("3110.34768", MarketPriceUnit.TROY_OUNCE).toString()).toBe("100");
    expect(goldPricePerGram("100", MarketPriceUnit.GRAM).toString()).toBe("100");
  });

  it("normalizes CoinGecko prices and keeps the API key in a request header", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        bitcoin: { eur: 67540, last_updated_at: 1787603740 },
      }), { status: 200 });
    };
    const provider = new CoinGeckoMarketDataProvider("server-secret", fetcher);
    const prices = await provider.getCurrentPrices({ assets: [btc], baseCurrency: "EUR" });

    expect(requestedUrl).toContain("ids=bitcoin");
    expect(new Headers(requestedInit?.headers).get("x-cg-demo-api-key")).toBe("server-secret");
    expect(prices).toEqual([expect.objectContaining({
      assetId: btc.id,
      symbol: "BTC",
      price: "67540",
      currency: "EUR",
      source: "COINGECKO",
    })]);
    expect(JSON.stringify(prices)).not.toContain("server-secret");
  });

  it("resolves a replaced CoinGecko key for every provider request", async () => {
    let key = "first-server-key";
    const observedKeys: Array<string | null> = [];
    const provider = new CoinGeckoMarketDataProvider(async () => key, async (_input, init) => {
      observedKeys.push(new Headers(init?.headers).get("x-cg-demo-api-key"));
      return new Response(JSON.stringify({ bitcoin: { eur: 60000 } }), { status: 200 });
    });
    await provider.getCurrentPrices({ assets: [btc], baseCurrency: "EUR" });
    key = "second-server-key";
    await provider.getCurrentPrices({ assets: [btc], baseCurrency: "EUR" });
    expect(observedKeys).toEqual(["first-server-key", "second-server-key"]);
  });

  it("returns deterministic one-to-one pricing for the EUR base asset", async () => {
    const eur = { ...btc, id: "eur-id", symbol: "EUR", currency: "EUR", externalId: null };
    const prices = await new BaseCurrencyMarketDataProvider().getCurrentPrices({ assets: [btc, eur], baseCurrency: "EUR" });
    expect(prices).toEqual([expect.objectContaining({ assetId: "eur-id", price: "1", source: "BASE_CURRENCY" })]);
  });

  it("rejects incompatible manual units", () => {
    expect(() => normalizeManualPrice(AssetType.ETF, "100", MarketPriceUnit.TROY_OUNCE)).toThrow("per asset unit");
    expect(() => normalizeManualPrice(AssetType.PHYSICAL_GOLD, "100", MarketPriceUnit.ASSET_UNIT)).toThrow("per gram or troy ounce");
  });

  it("normalizes a manual physical-gold quote to the holding unit", async () => {
    const physicalGold = {
      ...btc,
      id: "gold-id",
      symbol: "PHYSICAL_GOLD",
      assetType: AssetType.PHYSICAL_GOLD,
      externalId: null,
    };
    const provider = new ManualMarketDataProvider(async () => [{
      assetId: physicalGold.id,
      currency: "EUR",
      price: "3110.34768",
      unit: MarketPriceUnit.TROY_OUNCE,
      updatedAt: now,
    }]);

    const prices = await provider.getCurrentPrices({ assets: [physicalGold], baseCurrency: "EUR" });
    expect(prices).toEqual([expect.objectContaining({ price: "100", source: "MANUAL" })]);
  });
});

describe("market data cache service", () => {
  it("uses fresh persisted cache without calling a provider", async () => {
    const store = new FakeStore([cachedPrice({ fetchedAt: new Date(now.getTime() - 1_000), timestamp: now })]);
    const provider = providerReturning([]);
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [btc], now });

    expect(provider.getCurrentPrices).not.toHaveBeenCalled();
    expect(snapshot.prices[0].price).toBe("60000");
    expect(snapshot.hasStalePrices).toBe(false);
  });

  it("refreshes expired cache and persists normalized provider data", async () => {
    const store = new FakeStore([cachedPrice({ fetchedAt: new Date(now.getTime() - MARKET_PRICE_CACHE_TTL_MS) })]);
    const provider = providerReturning([quote("65000", now)]);
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [btc], now });

    expect(provider.getCurrentPrices).toHaveBeenCalledOnce();
    expect(snapshot.wasRefreshed).toBe(true);
    expect(snapshot.prices[0].price).toBe("65000");
  });

  it("blocks repeated forced refreshes during the cooldown", async () => {
    const store = new FakeStore([]);
    const provider = providerReturning([quote("65000", now)]);
    const service = new MarketDataService(store, [provider]);

    await service.getCurrentPrices({ assets: [btc], now, forceRefresh: true });
    const second = await service.getCurrentPrices({ assets: [btc], now: new Date(now.getTime() + 10_000), forceRefresh: true });

    expect(provider.getCurrentPrices).toHaveBeenCalledOnce();
    expect(second.wasRefreshed).toBe(false);
    expect(second.refreshBlockedUntil).not.toBeNull();
  });

  it("returns stale cache when a provider fails", async () => {
    const oldTimestamp = new Date(now.getTime() - 60 * 60 * 1_000);
    const store = new FakeStore([cachedPrice({ fetchedAt: oldTimestamp, timestamp: oldTimestamp })]);
    const provider: MarketDataProvider = {
      name: "FAILURE",
      getCurrentPrices: vi.fn(async () => { throw new Error("Provider unavailable."); }),
    };
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [btc], now });

    expect(snapshot.prices[0].price).toBe("60000");
    expect(snapshot.hasStalePrices).toBe(true);
    expect(snapshot.warning).toBe("FAILURE market data is temporarily unavailable.");
  });

  it("keeps missing and partial provider results unavailable without failing", async () => {
    const eth = { ...btc, id: "eth-id", symbol: "ETH", externalId: "ethereum" };
    const store = new FakeStore([]);
    const snapshot = await new MarketDataService(store, [providerReturning([quote("65000", now)])])
      .getCurrentPrices({ assets: [btc, eth], now });

    expect(snapshot.prices).toHaveLength(1);
    expect(snapshot.unavailableAssetIds).toEqual([eth.id]);
  });

  it("does not coalesce concurrent refreshes for different asset sets", async () => {
    const eth = { ...btc, id: "eth-id", symbol: "ETH", externalId: "ethereum" };
    const store = new FakeStore([]);
    const provider: MarketDataProvider = {
      name: "TEST",
      getCurrentPrices: vi.fn(async ({ assets }: { assets: MarketDataAsset[] }) => assets.map((asset) => ({
        assetId: asset.id,
        symbol: asset.symbol,
        price: asset.symbol === "BTC" ? "65000" : "3000",
        currency: "EUR",
        timestamp: now,
        source: "TEST",
      }))),
    };
    const service = new MarketDataService(store, [provider]);
    const [btcSnapshot, ethSnapshot] = await Promise.all([
      service.getCurrentPrices({ assets: [btc], now, forceRefresh: true }),
      service.getCurrentPrices({ assets: [eth], now, forceRefresh: true }),
    ]);

    expect(provider.getCurrentPrices).toHaveBeenCalledTimes(2);
    expect(btcSnapshot.prices).toEqual([expect.objectContaining({ assetId: btc.id })]);
    expect(ethSnapshot.prices).toEqual([expect.objectContaining({ assetId: eth.id })]);
  });
});

class FakeStore implements MarketDataStore {
  constructor(private prices: CachedMarketPrice[]) {}

  async listCachedPrices(assetIds: string[], currency: string) {
    return this.prices.filter((price) => assetIds.includes(price.assetId) && price.currency === currency);
  }

  async listManualPrices() {
    return [];
  }

  async saveCachedPrices(prices: MarketPrice[], fetchedAt: Date) {
    for (const price of prices) {
      this.prices = this.prices.filter((cached) => cached.assetId !== price.assetId || cached.currency !== price.currency);
      this.prices.push(cachedPrice({
        assetId: price.assetId,
        price: price.price,
        timestamp: price.timestamp,
        fetchedAt,
        source: price.source,
      }));
    }
  }
}

function cachedPrice(
  overrides: Partial<Omit<CachedMarketPrice, "price">> & { price?: string | Prisma.Decimal } = {},
): CachedMarketPrice {
  const normalizedPrice = new Prisma.Decimal(overrides.price ?? "60000");
  return {
    id: "cache-id",
    assetId: btc.id,
    currency: "EUR",
    timestamp: new Date(now.getTime() - 1_000),
    fetchedAt: new Date(now.getTime() - 1_000),
    source: "COINGECKO",
    createdAt: now,
    updatedAt: now,
    ...overrides,
    price: normalizedPrice,
  };
}

function quote(price: string, timestamp: Date): MarketPrice {
  return { assetId: btc.id, symbol: btc.symbol, price, currency: "EUR", timestamp, source: "TEST" };
}

function providerReturning(prices: MarketPrice[]): MarketDataProvider {
  return { name: "TEST", getCurrentPrices: vi.fn(async () => prices) };
}
