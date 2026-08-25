import { AssetType, MarketPriceUnit } from "@prisma/client";
import { z } from "zod";
import { resolveCoinGeckoApiKey } from "@/features/integrations/service";
import { goldPricePerGram } from "@/features/market-data/gold";
import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const responseSchema = z.record(
  z.string(),
  z.record(z.string(), z.number().positive()),
);

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;

export const PHYSICAL_GOLD_COINGECKO_REFERENCE_ID = "tether-gold";
export const PHYSICAL_GOLD_MARKET_SOURCE = "COINGECKO_XAUT";

export class CoinGeckoMarketDataProvider implements MarketDataProvider {
  readonly name = "COINGECKO";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveCoinGeckoApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const quoteCurrency = baseCurrency.toLowerCase();
    if (!/^[a-z]{3}$/.test(quoteCurrency)) {
      return [];
    }

    const supportedAssets = assets.flatMap((asset) => {
      const externalId = coinGeckoExternalId(asset);
      return externalId ? [{ asset, externalId }] : [];
    });

    if (supportedAssets.length === 0) {
      return [];
    }

    const ids = [...new Set(supportedAssets.map(({ externalId }) => externalId))];
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", quoteCurrency);
    url.searchParams.set("include_last_updated_at", "true");

    const headers = new Headers({ Accept: "application/json" });
    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (apiKey) {
      headers.set("x-cg-demo-api-key", apiKey);
    }

    const response = await this.fetcher(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`CoinGecko request failed with status ${response.status}.`);
    }

    const payload = responseSchema.parse(await response.json());
    const fallbackTimestamp = new Date();

    return supportedAssets.flatMap<MarketPrice>(({ asset, externalId }) => {
      const quote = payload[externalId];
      if (!quote) {
        return [];
      }

      const price = quote[quoteCurrency];
      if (!price) return [];

      const isPhysicalGold = asset.assetType === AssetType.PHYSICAL_GOLD;
      return [{
        assetId: asset.id,
        symbol: asset.symbol,
        price: isPhysicalGold
          ? goldPricePerGram(String(price), MarketPriceUnit.TROY_OUNCE).toString()
          : String(price),
        currency: baseCurrency,
        timestamp: quote.last_updated_at
          ? new Date(quote.last_updated_at * 1_000)
          : fallbackTimestamp,
        source: isPhysicalGold ? PHYSICAL_GOLD_MARKET_SOURCE : this.name,
      }];
    });
  }
}

function coinGeckoExternalId(asset: Parameters<MarketDataProvider["getCurrentPrices"]>[0]["assets"][number]) {
  return asset.assetType === AssetType.PHYSICAL_GOLD
    ? PHYSICAL_GOLD_COINGECKO_REFERENCE_ID
    : asset.externalId;
}
