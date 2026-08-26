import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchAssetsAction } from "@/features/asset-catalog/actions";
import { CoinGeckoAssetCatalogProvider } from "@/features/asset-catalog/providers/coingecko";
import { TwelveDataAssetCatalogProvider } from "@/features/asset-catalog/providers/twelve-data";
import { AssetCatalogService, resetAssetCatalogRuntimeCacheForTests } from "@/features/asset-catalog/service";
import type { AssetCatalogProvider } from "@/features/asset-catalog/types";

const localBtc = {
  id: "btc-local",
  symbol: "BTC",
  name: "Bitcoin",
  assetClass: "CRYPTO",
  assetType: "CRYPTO",
  currency: "BTC",
  externalId: "bitcoin",
  quoteProvider: null,
  quoteSymbol: null,
  quoteMicCode: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => resetAssetCatalogRuntimeCacheForTests());

describe("CoinGecko asset catalog provider", () => {
  it("normalizes search results and sends the API key only in a server-side header", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v3/search");
      expect(url.searchParams.get("query")).toBe("ethereum");
      expect(new Headers(init?.headers).get("x-cg-demo-api-key")).toBe("demo-secret");
      return new Response(JSON.stringify({
        coins: [{ id: "ethereum", name: "Ethereum", symbol: "eth", market_cap_rank: 2, thumb: "https://coin-images.coingecko.com/coins/images/279/thumb/ethereum.png" }],
      }), { status: 200 });
    });
    const provider = new CoinGeckoAssetCatalogProvider("demo-secret", fetcher as typeof fetch);

    await expect(provider.search("ethereum")).resolves.toEqual([expect.objectContaining({
      source: "COINGECKO",
      externalId: "ethereum",
      symbol: "ETH",
      name: "Ethereum",
      marketCapRank: 2,
      assetClass: "CRYPTO",
      assetType: "CRYPTO",
    })]);
  });

  it("classifies tokenized gold and stablecoins instead of treating every result as crypto", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      coins: [
        { id: "tether-gold", name: "Tether Gold", symbol: "xaut", market_cap_rank: 101, thumb: "https://coin-images.coingecko.com/coins/images/10481/thumb/tether-gold.png" },
        { id: "pax-gold", name: "PAX Gold", symbol: "paxg", market_cap_rank: 102, thumb: null },
        { id: "tether", name: "Tether", symbol: "usdt", market_cap_rank: 3, thumb: null },
        { id: "usd-coin", name: "USDC", symbol: "usdc", market_cap_rank: 6, thumb: null },
        { id: "solana", name: "Solana", symbol: "sol", market_cap_rank: 5, thumb: null },
      ],
    }), { status: 200 }));
    const provider = new CoinGeckoAssetCatalogProvider("", fetcher as typeof fetch);

    await expect(provider.search("token")).resolves.toEqual([
      expect.objectContaining({ symbol: "XAUT", assetClass: "GOLD", assetType: "TOKENIZED_GOLD", currency: "XAUT" }),
      expect.objectContaining({ symbol: "PAXG", assetClass: "GOLD", assetType: "TOKENIZED_GOLD", currency: "PAXG" }),
      expect.objectContaining({ symbol: "USDT", assetClass: "CASH", assetType: "STABLECOIN", currency: "USDT" }),
      expect.objectContaining({ symbol: "USDC", assetClass: "CASH", assetType: "STABLECOIN", currency: "USDC" }),
      expect.objectContaining({ symbol: "SOL", assetClass: "CRYPTO", assetType: "CRYPTO", currency: "SOL" }),
    ]);
  });
});

describe("Twelve Data asset catalog provider", () => {
  it("returns separate ETF listings with exact exchange identity", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/symbol_search");
      expect(url.searchParams.get("symbol")).toBe("vwce");
      expect(url.searchParams.get("apikey")).toBe("twelve-data-secret");
      return new Response(JSON.stringify({
        status: "ok",
        data: [
          { symbol: "VWCE", instrument_name: "Vanguard FTSE All-World UCITS ETF", exchange: "XETR", mic_code: "XETR", instrument_type: "ETF", country: "Germany", currency: "EUR", access: { plan: "Grow" } },
          { symbol: "VWCE", instrument_name: "Vanguard FTSE All-World UCITS ETF", exchange: "Euronext", mic_code: "XAMS", instrument_type: "ETF", country: "Netherlands", currency: "EUR", access: { plan: "Grow" } },
          { symbol: "VWCE", instrument_name: "Not an ETF", exchange: "TEST", mic_code: "TEST", instrument_type: "Common Stock", country: "Germany", currency: "EUR" },
        ],
      }), { status: 200 });
    });
    const provider = new TwelveDataAssetCatalogProvider("twelve-data-secret", fetcher as typeof fetch);

    await expect(provider.search("vwce")).resolves.toEqual([
      expect.objectContaining({ source: "TWELVE_DATA", symbol: "VWCE", quoteSymbol: "VWCE", quoteMicCode: "XETR", exchange: "XETR", currency: "EUR", accessPlan: "Grow" }),
      expect.objectContaining({ source: "TWELVE_DATA", symbol: "VWCE", quoteMicCode: "XAMS", exchange: "Euronext" }),
    ]);
  });
});

describe("asset catalog service", () => {
  it("puts local assets first and removes a duplicate CoinGecko result", async () => {
    const remoteResult = {
      source: "COINGECKO",
      externalId: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      imageUrl: null,
      marketCapRank: 1,
      existingAssetId: null,
      assetClass: "CRYPTO",
      assetType: "CRYPTO",
      currency: "BTC",
      quoteProvider: null,
      quoteSymbol: null,
      quoteMicCode: null,
      exchange: null,
      country: null,
      accessPlan: null,
      isSymbolConflict: false,
    } as const;
    const provider: AssetCatalogProvider = {
      name: "TEST",
      search: vi.fn(async () => [remoteResult]),
    };
    const service = new AssetCatalogService({ listAssets: async () => [localBtc] } as never, providers(provider));

    const result = await service.search("btc");

    expect(result.warning).toBeNull();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ source: "LOCAL", existingAssetId: "btc-local" });
  });

  it("caches repeated provider searches", async () => {
    const search = vi.fn(async () => []);
    const service = new AssetCatalogService({ listAssets: async () => [] } as never, providers({ name: "TEST", search }));

    await service.search("solana", "CRYPTO", 1_000);
    await service.search("solana", "CRYPTO", 2_000);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("returns local matches when the online provider fails", async () => {
    const service = new AssetCatalogService(
      { listAssets: async () => [localBtc] } as never,
      providers({ name: "TEST", search: async () => { throw new Error("offline"); } }),
    );

    const result = await service.search("bitcoin");

    expect(result.results).toHaveLength(1);
    expect(result.warning).toContain("temporarily unavailable");
  });

  it("rejects short search queries before accessing the catalog", async () => {
    const result = await searchAssetsAction("x");
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([]);
  });

  it("keeps a local ETF and exposes another Twelve Data listing as a remap", async () => {
    const localVwce = {
      ...localBtc,
      id: "vwce-local",
      symbol: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF",
      assetClass: "ETF",
      assetType: "ETF",
      currency: "EUR",
      externalId: null,
      quoteProvider: "TWELVE_DATA",
      quoteSymbol: "VWCE",
      quoteMicCode: "XETR",
    } as const;
    const xetr = twelveDataResult("XETR", "XETR");
    const amsterdam = twelveDataResult("XAMS", "Euronext");
    const provider: AssetCatalogProvider = { name: "TWELVE_DATA", search: vi.fn(async () => [xetr, amsterdam]) };
    const service = new AssetCatalogService({ listAssets: async () => [localVwce] } as never, providers(provider));

    const result = await service.search("vwce", "ETF");

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ source: "LOCAL", quoteMicCode: "XETR" });
    expect(result.results[1]).toMatchObject({ source: "TWELVE_DATA", quoteMicCode: "XAMS", existingAssetId: "vwce-local", isSymbolConflict: false });
  });
});

function providers(provider: AssetCatalogProvider) {
  return { CRYPTO: provider, ETF: provider };
}

function twelveDataResult(mic: string, exchange: string) {
  return {
    source: "TWELVE_DATA",
    externalId: null,
    symbol: "VWCE",
    name: "Vanguard FTSE All-World UCITS ETF",
    imageUrl: null,
    marketCapRank: null,
    existingAssetId: null,
    assetClass: "ETF",
    assetType: "ETF",
    currency: "EUR",
    quoteProvider: "TWELVE_DATA",
    quoteSymbol: "VWCE",
    quoteMicCode: mic,
    exchange,
    country: "Germany",
    accessPlan: "Grow",
    isSymbolConflict: false,
  } as const;
}
