import "server-only";

import { z } from "zod";
import { resolveCoinGeckoApiKey } from "@/features/integrations/service";
import type { AssetCatalogProvider, AssetCatalogResult } from "@/features/asset-catalog/types";

const responseSchema = z.object({
  coins: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    symbol: z.string().min(1),
    market_cap_rank: z.number().int().positive().nullable().optional(),
    thumb: z.string().url().nullable().optional(),
  })),
});

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;

export class CoinGeckoAssetCatalogProvider implements AssetCatalogProvider {
  readonly name = "COINGECKO";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveCoinGeckoApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async search(query: string): Promise<AssetCatalogResult[]> {
    const url = new URL("https://api.coingecko.com/api/v3/search");
    url.searchParams.set("query", query);
    const headers = new Headers({ Accept: "application/json" });
    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (apiKey) headers.set("x-cg-demo-api-key", apiKey);

    const response = await this.fetcher(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`CoinGecko search failed with status ${response.status}.`);

    const payload = responseSchema.parse(await response.json());
    return payload.coins.slice(0, 8).map((coin) => ({
      source: "COINGECKO",
      externalId: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      imageUrl: safeCoinGeckoImageUrl(coin.thumb),
      marketCapRank: coin.market_cap_rank ?? null,
      existingAssetId: null,
      assetClass: "CRYPTO",
      assetType: "CRYPTO",
      currency: coin.symbol.toUpperCase(),
      isSymbolConflict: false,
    }));
  }
}

function safeCoinGeckoImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || !["assets.coingecko.com", "coin-images.coingecko.com"].includes(url.hostname)) {
    return null;
  }
  return url.toString();
}
