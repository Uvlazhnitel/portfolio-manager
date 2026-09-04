import { AssetType } from "@prisma/client";
import { z } from "zod";
import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const exchangeRateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: z.number().positive(),
});

type FetchLike = typeof fetch;

export const FRANKFURTER_MARKET_SOURCE = "FRANKFURTER";

export class FrankfurterMarketDataProvider implements MarketDataProvider {
  readonly name = FRANKFURTER_MARKET_SOURCE;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const quoteCurrency = normalizeCurrency(baseCurrency);
    if (!quoteCurrency) return [];

    const supportedAssets = assets.flatMap((asset) => {
      const assetCurrency = normalizeCurrency(asset.currency);
      return asset.assetType === AssetType.FIAT && assetCurrency && assetCurrency !== quoteCurrency
        ? [{ asset, assetCurrency }]
        : [];
    });
    const currencies = [...new Set(supportedAssets.map(({ assetCurrency }) => assetCurrency))];
    const rates = await Promise.all(currencies.map(async (currency) => (
      [currency, await this.fetchRate(currency, quoteCurrency)] as const
    )));
    const ratesByCurrency = new Map(rates);

    return supportedAssets.map<MarketPrice>(({ asset, assetCurrency }) => {
      const rate = ratesByCurrency.get(assetCurrency);
      if (!rate) throw new Error(`Frankfurter FX rate is missing for ${assetCurrency}/${quoteCurrency}.`);
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        price: String(rate.rate),
        currency: quoteCurrency,
        timestamp: new Date(`${rate.date}T00:00:00.000Z`),
        source: this.name,
      };
    });
  }

  private async fetchRate(baseCurrency: string, quoteCurrency: string) {
    const url = new URL(`https://api.frankfurter.dev/v2/rate/${baseCurrency}/${quoteCurrency}`);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Frankfurter request failed with status ${response.status}.`);

    const rate = exchangeRateSchema.parse(await response.json());
    if (rate.base.toUpperCase() !== baseCurrency || rate.quote.toUpperCase() !== quoteCurrency) {
      throw new Error(`Frankfurter returned a different FX pair for ${baseCurrency}/${quoteCurrency}.`);
    }
    return rate;
  }
}

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}
