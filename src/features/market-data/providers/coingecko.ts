import { z } from "zod";
import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const responseSchema = z.record(
  z.string(),
  z.object({
    eur: z.number().positive(),
    last_updated_at: z.number().int().positive().optional(),
  }),
);

type FetchLike = typeof fetch;

export class CoinGeckoMarketDataProvider implements MarketDataProvider {
  readonly name = "COINGECKO";

  constructor(
    private readonly apiKey = process.env.COINGECKO_API_KEY,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    if (baseCurrency !== "EUR") {
      return [];
    }

    const supportedAssets = assets.filter((asset) => asset.externalId);

    if (supportedAssets.length === 0) {
      return [];
    }

    const ids = [...new Set(supportedAssets.map((asset) => asset.externalId as string))];
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", "eur");
    url.searchParams.set("include_last_updated_at", "true");

    const headers = new Headers({ Accept: "application/json" });
    if (this.apiKey) {
      headers.set("x-cg-demo-api-key", this.apiKey);
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

    return supportedAssets.flatMap<MarketPrice>((asset) => {
      const quote = payload[asset.externalId as string];
      if (!quote) {
        return [];
      }

      return [{
        assetId: asset.id,
        symbol: asset.symbol,
        price: String(quote.eur),
        currency: baseCurrency,
        timestamp: quote.last_updated_at
          ? new Date(quote.last_updated_at * 1_000)
          : fallbackTimestamp,
        source: this.name,
      }];
    });
  }
}
