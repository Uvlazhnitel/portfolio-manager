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
type CoinGeckoCoin = z.infer<typeof responseSchema>["coins"][number];

const tokenizedGoldSymbols = new Set(["XAUT", "PAXG"]);
const tokenizedGoldIds = new Set(["tether-gold", "pax-gold"]);
const stablecoinSymbols = new Set(["USDT", "USDC", "DAI", "TUSD", "USDP", "PYUSD", "FDUSD", "USDE", "EURC"]);
const stablecoinIds = new Set([
  "tether",
  "usd-coin",
  "dai",
  "true-usd",
  "paxos-standard",
  "paypal-usd",
  "first-digital-usd",
  "ethena-usde",
  "euro-coin",
]);

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
    return payload.coins.slice(0, 8).map((coin) => {
      const symbol = coin.symbol.toUpperCase();
      const classification = classifyCoinGeckoCoin(coin);

      return {
        source: "COINGECKO",
        externalId: coin.id,
        symbol,
        name: coin.name,
        imageUrl: safeCoinGeckoImageUrl(coin.thumb),
        marketCapRank: coin.market_cap_rank ?? null,
        existingAssetId: null,
        ...classification,
        currency: symbol,
        isSymbolConflict: false,
      };
    });
  }
}

function classifyCoinGeckoCoin(coin: CoinGeckoCoin): Pick<AssetCatalogResult, "assetClass" | "assetType"> {
  const symbol = coin.symbol.toUpperCase();
  const id = coin.id.toLowerCase();

  if (tokenizedGoldSymbols.has(symbol) || tokenizedGoldIds.has(id)) {
    return { assetClass: "GOLD", assetType: "TOKENIZED_GOLD" };
  }

  if (stablecoinSymbols.has(symbol) || stablecoinIds.has(id)) {
    return { assetClass: "CASH", assetType: "STABLECOIN" };
  }

  return { assetClass: "CRYPTO", assetType: "CRYPTO" };
}

function safeCoinGeckoImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || !["assets.coingecko.com", "coin-images.coingecko.com"].includes(url.hostname)) {
    return null;
  }
  return url.toString();
}
