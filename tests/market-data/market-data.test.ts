import { AssetQuoteProvider, AssetType, MarketPriceUnit, Prisma, type CachedMarketPrice } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatPhysicalGoldQuantity,
  formatTroyOunces,
  goldPricePerGram,
  gramsToTroyOunces,
  GRAMS_PER_TROY_OUNCE,
  pricePerTroyOunce,
  troyOuncesToGrams,
} from "@/features/market-data/gold";
import { BaseCurrencyMarketDataProvider } from "@/features/market-data/providers/base-currency";
import { CoinGeckoMarketDataProvider } from "@/features/market-data/providers/coingecko";
import { ManualMarketDataProvider, normalizeManualPrice } from "@/features/market-data/providers/manual";
import { AlphaVantageMarketDataProvider } from "@/features/market-data/providers/alpha-vantage";
import { TwelveDataMarketDataProvider } from "@/features/market-data/providers/twelve-data";
import type { MarketDataStore } from "@/features/market-data/repository";
import {
  MANUAL_PRICE_STALE_AFTER_MS,
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
  quoteProvider: null,
  quoteSymbol: null,
  quoteMicCode: null,
};
const xaut: MarketDataAsset = {
  id: "xaut-id",
  symbol: "XAUT",
  name: "Tether Gold",
  assetType: AssetType.TOKENIZED_GOLD,
  currency: "XAUT",
  externalId: "tether-gold",
  quoteProvider: null,
  quoteSymbol: null,
  quoteMicCode: null,
};
const physicalGold: MarketDataAsset = {
  id: "physical-gold-id",
  symbol: "PHYSICAL_GOLD",
  name: "Physical Gold",
  assetType: AssetType.PHYSICAL_GOLD,
  currency: "XAU",
  externalId: null,
  quoteProvider: null,
  quoteSymbol: null,
  quoteMicCode: null,
};
const vwce: MarketDataAsset = {
  id: "vwce-id",
  symbol: "VWCE",
  name: "Vanguard FTSE All-World UCITS ETF",
  assetType: AssetType.ETF,
  currency: "EUR",
  externalId: null,
  quoteProvider: AssetQuoteProvider.TWELVE_DATA,
  quoteSymbol: "VWCE",
  quoteMicCode: "XETR",
};
const alphaVwce: MarketDataAsset = {
  ...vwce,
  quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
  quoteSymbol: "VWCE.DEX",
};

beforeEach(() => resetMarketDataRuntimeCacheForTests());

describe("market data providers", () => {
  it("converts troy ounces to grams without using regular ounces", () => {
    expect(GRAMS_PER_TROY_OUNCE).toBe("31.1034768");
    expect(goldPricePerGram("3110.34768", MarketPriceUnit.TROY_OUNCE).toString()).toBe("100");
    expect(goldPricePerGram("100", MarketPriceUnit.GRAM).toString()).toBe("100");
    expect(troyOuncesToGrams("0.0643").toString()).toBe("1.99995355824");
    expect(gramsToTroyOunces("5.42133600624").toString()).toBe("0.1743");
    expect(pricePerTroyOunce("100").toString()).toBe("3110.34768");
  });

  it("formats physical gold with at most four decimal places and no trailing zeros", () => {
    expect(formatTroyOunces("0.17430000")).toBe("0.1743");
    expect(formatTroyOunces("0.11000000")).toBe("0.11");
    expect(formatTroyOunces("123456.789123")).toBe("123456.7891");
    expect(formatTroyOunces("0.000049")).toBe("0");
    expect(formatPhysicalGoldQuantity("5.42133600624")).toBe("0.1743 oz");
  });

  it("normalizes CoinGecko prices and keeps the API key in a request header", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        bitcoin: { usd: 79540, last_updated_at: 1787603740 },
      }), { status: 200 });
    };
    const provider = new CoinGeckoMarketDataProvider("server-secret", fetcher);
    const prices = await provider.getCurrentPrices({ assets: [btc], baseCurrency: "USD" });

    expect(requestedUrl).toContain("ids=bitcoin");
    expect(requestedUrl).toContain("vs_currencies=usd");
    expect(new Headers(requestedInit?.headers).get("x-cg-demo-api-key")).toBe("server-secret");
    expect(prices).toEqual([expect.objectContaining({
      assetId: btc.id,
      symbol: "BTC",
      price: "79540",
      currency: "USD",
      source: "COINGECKO",
    })]);
    expect(JSON.stringify(prices)).not.toContain("server-secret");
  });

  it("uses one XAUT quote for tokenized and physical gold", async () => {
    let requestedUrl = "";
    const provider = new CoinGeckoMarketDataProvider("", async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        "tether-gold": { usd: 4630.37, last_updated_at: 1787603740 },
      }), { status: 200 });
    });

    const prices = await provider.getCurrentPrices({ assets: [xaut, physicalGold], baseCurrency: "USD" });
    const ids = new URL(requestedUrl).searchParams.get("ids");
    const xautPrice = prices.find((price) => price.assetId === xaut.id);
    const physicalPrice = prices.find((price) => price.assetId === physicalGold.id);

    expect(ids).toBe("tether-gold");
    expect(xautPrice).toEqual(expect.objectContaining({ price: "4630.37", source: "COINGECKO" }));
    expect(physicalPrice).toEqual(expect.objectContaining({ source: "COINGECKO_XAUT" }));
    expect(pricePerTroyOunce(physicalPrice?.price ?? "0").toDecimalPlaces(2).toString()).toBe("4630.37");
    expect(physicalPrice?.timestamp).toEqual(xautPrice?.timestamp);
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

  it("converts Twelve Data ETF quotes to USD and deduplicates FX requests", async () => {
    const iwda = { ...vwce, id: "iwda-id", symbol: "IWDA", name: "iShares Core MSCI World", quoteSymbol: "IWDA", quoteMicCode: "XAMS" };
    const requestedUrls: URL[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      expect(url.searchParams.get("apikey")).toBe("twelve-secret");
      if (url.pathname === "/quote") {
        const symbol = url.searchParams.get("symbol") ?? "";
        const mic = url.searchParams.get("mic_code") ?? "";
        return new Response(JSON.stringify({ symbol, mic_code: mic, currency: "EUR", close: symbol === "VWCE" ? "120.5" : "95", timestamp: 1787603700, last_quote_at: 1787603740 }), { status: 200 });
      }
      return new Response(JSON.stringify({ symbol: "EUR/USD", rate: 1.17, timestamp: 1787603600 }), { status: 200 });
    });
    const provider = new TwelveDataMarketDataProvider("twelve-secret", fetcher as typeof fetch);

    const prices = await provider.getCurrentPrices({ assets: [vwce, iwda], baseCurrency: "USD" });

    expect(prices).toEqual([
      expect.objectContaining({ assetId: "vwce-id", price: "140.985", currency: "USD", source: "TWELVE_DATA", timestamp: new Date(1787603600 * 1_000) }),
      expect.objectContaining({ assetId: "iwda-id", price: "111.15", currency: "USD", source: "TWELVE_DATA", timestamp: new Date(1787603600 * 1_000) }),
    ]);
    expect(requestedUrls.filter((url) => url.pathname === "/quote")).toHaveLength(2);
    expect(requestedUrls.filter((url) => url.pathname === "/exchange_rate")).toHaveLength(1);
  });

  it("converts Alpha Vantage ETF daily close to USD and deduplicates FX requests", async () => {
    const iwda = { ...alphaVwce, id: "iwda-id", symbol: "IWDA", name: "iShares Core MSCI World", quoteSymbol: "IWDA.AMS", quoteMicCode: "XAMS" };
    const requestedUrls: URL[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      expect(url.searchParams.get("apikey")).toBe("alpha-secret");
      if (url.searchParams.get("function") === "TIME_SERIES_DAILY") {
        const symbol = url.searchParams.get("symbol") ?? "";
        return new Response(JSON.stringify({
          "Meta Data": { "2. Symbol": symbol },
          "Time Series (Daily)": {
            "2026-08-24": { "4. close": symbol === "VWCE.DEX" ? "120.5" : "95" },
            "2026-08-23": { "4. close": "1" },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        "Realtime Currency Exchange Rate": {
          "1. From_Currency Code": "EUR",
          "3. To_Currency Code": "USD",
          "5. Exchange Rate": "1.17",
          "6. Last Refreshed": "2026-08-24 20:00:00",
        },
      }), { status: 200 });
    });
    const provider = new AlphaVantageMarketDataProvider("alpha-secret", fetcher as typeof fetch, 0);

    const prices = await provider.getCurrentPrices({ assets: [alphaVwce, iwda], baseCurrency: "USD" });

    expect(prices).toEqual([
      expect.objectContaining({ assetId: "vwce-id", price: "140.985", currency: "USD", source: "ALPHA_VANTAGE", timestamp: new Date("2026-08-24T20:00:00.000Z") }),
      expect.objectContaining({ assetId: "iwda-id", price: "111.15", currency: "USD", source: "ALPHA_VANTAGE", timestamp: new Date("2026-08-24T20:00:00.000Z") }),
    ]);
    expect(requestedUrls.filter((url) => url.searchParams.get("function") === "TIME_SERIES_DAILY")).toHaveLength(2);
    expect(requestedUrls.filter((url) => url.searchParams.get("function") === "CURRENCY_EXCHANGE_RATE")).toHaveLength(1);
  });

  it("prices Alpha Vantage ETF listings without MIC metadata", async () => {
    const noMic = { ...alphaVwce, quoteSymbol: "PLAIN", quoteMicCode: null };
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("function") === "TIME_SERIES_DAILY") {
        return new Response(JSON.stringify({
          "Meta Data": { "2. Symbol": "PLAIN" },
          "Time Series (Daily)": { "2026-08-24": { "4. close": "100" } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        "Realtime Currency Exchange Rate": {
          "1. From_Currency Code": "EUR",
          "3. To_Currency Code": "USD",
          "5. Exchange Rate": "1.1",
          "6. Last Refreshed": "2026-08-24 20:00:00",
        },
      }), { status: 200 });
    });
    const provider = new AlphaVantageMarketDataProvider("alpha-secret", fetcher as typeof fetch, 0);

    await expect(provider.getCurrentPrices({ assets: [noMic], baseCurrency: "USD" })).resolves.toEqual([
      expect.objectContaining({ assetId: "vwce-id", price: "110", source: "ALPHA_VANTAGE" }),
    ]);
  });

  it("rejects Alpha Vantage rate limits and malformed daily responses", async () => {
    const limited = new AlphaVantageMarketDataProvider("alpha-secret", vi.fn(async () => new Response(JSON.stringify({ Note: "rate limit" }), { status: 200 })) as typeof fetch, 0);
    await expect(limited.getCurrentPrices({ assets: [alphaVwce], baseCurrency: "USD" })).rejects.toThrow("rejected");

    const malformed = new AlphaVantageMarketDataProvider("alpha-secret", vi.fn(async () => new Response(JSON.stringify({
      "Meta Data": { "2. Symbol": "VWCE.DEX" },
      "Time Series (Daily)": { "2026-08-24": { "4. close": 120.5 } },
    }), { status: 200 })) as typeof fetch, 0);
    await expect(malformed.getCurrentPrices({ assets: [alphaVwce], baseCurrency: "USD" })).rejects.toThrow();
  });

  it("does not call Alpha Vantage until a key is configured", async () => {
    const fetcher = vi.fn();
    const provider = new AlphaVantageMarketDataProvider(async () => undefined, fetcher as typeof fetch, 0);
    await expect(provider.getCurrentPrices({ assets: [alphaVwce], baseCurrency: "USD" })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects Twelve Data plan errors and malformed listing responses", async () => {
    const planRestricted = new TwelveDataMarketDataProvider("twelve-secret", vi.fn(async () => new Response(JSON.stringify({ status: "error", code: 401, message: "Grow plan required" }), { status: 200 })) as typeof fetch);
    await expect(planRestricted.getCurrentPrices({ assets: [vwce], baseCurrency: "USD" })).rejects.toThrow("rejected");

    const malformed = new TwelveDataMarketDataProvider("twelve-secret", vi.fn(async () => new Response(JSON.stringify({ symbol: "VWCE", mic_code: "XETR", currency: "EUR", close: 120.5, timestamp: 1787603700 }), { status: 200 })) as typeof fetch);
    await expect(malformed.getCurrentPrices({ assets: [vwce], baseCurrency: "USD" })).rejects.toThrow();
  });

  it("does not call Twelve Data until a key is configured", async () => {
    const fetcher = vi.fn();
    const provider = new TwelveDataMarketDataProvider(async () => undefined, fetcher as typeof fetch);
    await expect(provider.getCurrentPrices({ assets: [vwce], baseCurrency: "USD" })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns deterministic one-to-one pricing for the USD base asset", async () => {
    const usd = { ...btc, id: "usd-id", symbol: "USD", currency: "USD", externalId: null };
    const prices = await new BaseCurrencyMarketDataProvider().getCurrentPrices({ assets: [btc, usd], baseCurrency: "USD" });
    expect(prices).toEqual([expect.objectContaining({ assetId: "usd-id", price: "1", source: "BASE_CURRENCY" })]);
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
      currency: "USD",
      price: "3110.34768",
      unit: MarketPriceUnit.TROY_OUNCE,
      updatedAt: now,
    }]);

    const prices = await provider.getCurrentPrices({ assets: [physicalGold], baseCurrency: "USD" });
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

  it("reuses same-day Alpha Vantage ETF cache instead of refreshing every five minutes", async () => {
    const oldSameDay = new Date("2026-08-24T08:00:00.000Z");
    const store = new FakeStore([cachedPrice({
      assetId: alphaVwce.id,
      fetchedAt: oldSameDay,
      timestamp: oldSameDay,
      source: "ALPHA_VANTAGE",
      price: "140",
    })]);
    const provider = providerReturning([{
      assetId: alphaVwce.id,
      symbol: alphaVwce.symbol,
      price: "150",
      currency: "USD",
      timestamp: now,
      source: "ALPHA_VANTAGE",
    }]);
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [alphaVwce], now });

    expect(provider.getCurrentPrices).not.toHaveBeenCalled();
    expect(snapshot.prices[0].price).toBe("140");
    expect(snapshot.prices[0].isStale).toBe(false);
    expect(snapshot.hasStalePrices).toBe(false);
  });

  it("keeps the latest Alpha trading-day close fresh after a successful weekend check", async () => {
    const sunday = new Date("2026-08-30T12:00:00.000Z");
    const store = new FakeStore([cachedPrice({
      assetId: alphaVwce.id,
      fetchedAt: new Date("2026-08-30T08:00:00.000Z"),
      timestamp: new Date("2026-08-28T23:59:59.000Z"),
      source: "ALPHA_VANTAGE",
      price: "140",
    })]);
    const provider = providerReturning([]);
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [alphaVwce], now: sunday });

    expect(provider.getCurrentPrices).not.toHaveBeenCalled();
    expect(snapshot.prices[0]).toEqual(expect.objectContaining({ source: "ALPHA_VANTAGE", isStale: false }));
  });

  it("marks an unverified previous-day Alpha cache stale when the daily refresh fails", async () => {
    const tuesday = new Date("2026-09-01T08:00:00.000Z");
    const store = new FakeStore([cachedPrice({
      assetId: alphaVwce.id,
      fetchedAt: new Date("2026-08-31T08:00:00.000Z"),
      timestamp: new Date("2026-08-28T23:59:59.000Z"),
      source: "ALPHA_VANTAGE",
      price: "140",
    })]);
    const provider: MarketDataProvider = {
      name: "ALPHA_VANTAGE",
      getCurrentPrices: vi.fn(async () => { throw new Error("Unavailable"); }),
    };
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [alphaVwce], now: tuesday });

    expect(provider.getCurrentPrices).toHaveBeenCalledOnce();
    expect(snapshot.prices[0].isStale).toBe(true);
    expect(snapshot.warning).toContain("ALPHA_VANTAGE");
  });

  it("makes Alpha fresh again after the next successful daily verification", async () => {
    const tuesday = new Date("2026-09-01T08:00:00.000Z");
    const store = new FakeStore([cachedPrice({
      assetId: alphaVwce.id,
      fetchedAt: new Date("2026-08-31T08:00:00.000Z"),
      timestamp: new Date("2026-08-28T23:59:59.000Z"),
      source: "ALPHA_VANTAGE",
      price: "140",
    })]);
    const provider = providerReturning([{
      assetId: alphaVwce.id,
      symbol: alphaVwce.symbol,
      price: "141",
      currency: "USD",
      timestamp: new Date("2026-08-31T23:59:59.000Z"),
      source: "ALPHA_VANTAGE",
    }]);
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({ assets: [alphaVwce], now: tuesday });

    expect(provider.getCurrentPrices).toHaveBeenCalledOnce();
    expect(snapshot.prices[0]).toEqual(expect.objectContaining({ price: "141", isStale: false }));
  });

  it("keeps the fifteen-minute stale policy for CoinGecko-like sources", async () => {
    const freshStore = new FakeStore([cachedPrice({
      fetchedAt: new Date(now.getTime() - 1_000),
      timestamp: new Date(now.getTime() - 14 * 60 * 1_000),
      source: "COINGECKO",
    })]);
    const staleStore = new FakeStore([cachedPrice({
      fetchedAt: new Date(now.getTime() - 1_000),
      timestamp: new Date(now.getTime() - 15 * 60 * 1_000),
      source: "COINGECKO",
    })]);

    const fresh = await new MarketDataService(freshStore, [providerReturning([])]).getCurrentPrices({ assets: [btc], now });
    const stale = await new MarketDataService(staleStore, [providerReturning([])]).getCurrentPrices({ assets: [btc], now });

    expect(fresh.prices[0].isStale).toBe(false);
    expect(stale.prices[0].isStale).toBe(true);
  });

  it("keeps manual prices fresh for seven days", async () => {
    const freshStore = new FakeStore([cachedPrice({
      fetchedAt: new Date(now.getTime() - 1_000),
      timestamp: new Date(now.getTime() - MANUAL_PRICE_STALE_AFTER_MS + 1_000),
      source: "MANUAL",
    })]);
    const staleStore = new FakeStore([cachedPrice({
      fetchedAt: new Date(now.getTime() - 1_000),
      timestamp: new Date(now.getTime() - MANUAL_PRICE_STALE_AFTER_MS),
      source: "MANUAL",
    })]);

    const fresh = await new MarketDataService(freshStore, [providerReturning([])]).getCurrentPrices({ assets: [btc], now });
    const stale = await new MarketDataService(staleStore, [providerReturning([])]).getCurrentPrices({ assets: [btc], now });

    expect(fresh.prices[0].isStale).toBe(false);
    expect(stale.prices[0].isStale).toBe(true);
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

  it("refreshes XAUT and physical gold together and keeps their timestamps aligned", async () => {
    const store = new FakeStore([
      cachedPrice({ assetId: xaut.id, price: "4600", fetchedAt: new Date(now.getTime() - 1_000) }),
    ]);
    const provider: MarketDataProvider = {
      name: "COINGECKO",
      getCurrentPrices: vi.fn(async ({ assets }: { assets: MarketDataAsset[] }) => assets.map((asset) => ({
        assetId: asset.id,
        symbol: asset.symbol,
        price: asset.assetType === AssetType.PHYSICAL_GOLD
          ? goldPricePerGram("4630.37", MarketPriceUnit.TROY_OUNCE).toString()
          : "4630.37",
        currency: "USD",
        timestamp: now,
        source: asset.assetType === AssetType.PHYSICAL_GOLD ? "COINGECKO_XAUT" : "COINGECKO",
      }))),
    };
    const snapshot = await new MarketDataService(store, [provider]).getCurrentPrices({
      assets: [xaut, physicalGold],
      now,
    });
    const requestedAssets = vi.mocked(provider.getCurrentPrices).mock.calls[0]?.[0].assets;
    const xautPrice = snapshot.prices.find((price) => price.assetId === xaut.id);
    const physicalPrice = snapshot.prices.find((price) => price.assetId === physicalGold.id);

    expect(requestedAssets?.map((asset) => asset.id)).toEqual([physicalGold.id, xaut.id]);
    expect(xautPrice?.timestamp).toEqual(physicalPrice?.timestamp);
    expect(pricePerTroyOunce(physicalPrice?.price ?? "0").toDecimalPlaces(2).toString()).toBe(xautPrice?.price);
  });

  it("derives physical gold from cached XAUT when refresh fails", async () => {
    const oldTimestamp = new Date(now.getTime() - 60 * 60 * 1_000);
    const store = new FakeStore([
      cachedPrice({ assetId: xaut.id, price: "4630.37", fetchedAt: oldTimestamp, timestamp: oldTimestamp }),
    ]);
    const failure: MarketDataProvider = {
      name: "COINGECKO",
      getCurrentPrices: vi.fn(async () => { throw new Error("Unavailable"); }),
    };
    const manual: MarketDataProvider = {
      name: "MANUAL",
      getCurrentPrices: vi.fn(async () => []),
    };
    const snapshot = await new MarketDataService(store, [failure, manual]).getCurrentPrices({
      assets: [xaut, physicalGold],
      now,
    });
    const physicalPrice = snapshot.prices.find((price) => price.assetId === physicalGold.id);

    expect(physicalPrice).toEqual(expect.objectContaining({ source: "COINGECKO_XAUT", isStale: true }));
    expect(pricePerTroyOunce(physicalPrice?.price ?? "0").toDecimalPlaces(2).toString()).toBe("4630.37");
    expect(snapshot.unavailableAssetIds).not.toContain(physicalGold.id);
    expect(manual.getCurrentPrices).not.toHaveBeenCalled();
  });

  it("uses a manual physical-gold quote only when XAUT data is unavailable", async () => {
    const store = new FakeStore([]);
    const failure: MarketDataProvider = {
      name: "COINGECKO",
      getCurrentPrices: vi.fn(async () => { throw new Error("Unavailable"); }),
    };
    const manual: MarketDataProvider = {
      name: "MANUAL",
      getCurrentPrices: vi.fn(async ({ assets }: { assets: MarketDataAsset[] }) => assets
        .filter((asset) => asset.assetType === AssetType.PHYSICAL_GOLD)
        .map((asset) => ({
          assetId: asset.id,
          symbol: asset.symbol,
          price: "100",
          currency: "USD",
          timestamp: now,
          source: "MANUAL",
        }))),
    };
    const snapshot = await new MarketDataService(store, [failure, manual]).getCurrentPrices({
      assets: [xaut, physicalGold],
      now,
    });

    expect(snapshot.prices.find((price) => price.assetId === physicalGold.id)).toEqual(
      expect.objectContaining({ price: "100", source: "MANUAL" }),
    );
    expect(snapshot.unavailableAssetIds).toContain(xaut.id);
  });

  it("falls back to a manual ETF price when automatic ETF data is unavailable", async () => {
    const store = new FakeStore([]);
    const failure: MarketDataProvider = {
      name: "ALPHA_VANTAGE",
      getCurrentPrices: vi.fn(async () => { throw new Error("Grow access unavailable"); }),
    };
    const manual: MarketDataProvider = {
      name: "MANUAL",
      getCurrentPrices: vi.fn(async ({ assets }: { assets: MarketDataAsset[] }) => assets.map((asset) => ({
        assetId: asset.id,
        symbol: asset.symbol,
        price: "140",
        currency: "USD",
        timestamp: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000),
        source: "MANUAL",
      }))),
    };

    const snapshot = await new MarketDataService(store, [failure, manual]).getCurrentPrices({ assets: [alphaVwce], now });

    expect(snapshot.prices).toEqual([expect.objectContaining({ assetId: alphaVwce.id, price: "140", source: "MANUAL", isStale: true })]);
    expect(snapshot.warning).toContain("ALPHA_VANTAGE");
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
        currency: "USD",
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
    currency: "USD",
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
  return { assetId: btc.id, symbol: btc.symbol, price, currency: "USD", timestamp, source: "TEST" };
}

function providerReturning(prices: MarketPrice[]): MarketDataProvider {
  return { name: "TEST", getCurrentPrices: vi.fn(async () => prices) };
}
