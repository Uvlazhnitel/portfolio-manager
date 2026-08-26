import { AssetQuoteProvider, AssetType, Prisma } from "@prisma/client";
import { z } from "zod";
import { resolveTwelveDataApiKey } from "@/features/integrations/service";
import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const quoteSchema = z.object({
  symbol: z.string().min(1),
  mic_code: z.string().min(1),
  currency: z.string().length(3),
  close: z.string().regex(/^\d+(?:\.\d+)?$/),
  timestamp: z.number().int().positive(),
  last_quote_at: z.number().int().positive().optional(),
});

const exchangeRateSchema = z.object({
  symbol: z.string().min(7),
  rate: z.number().positive(),
  timestamp: z.number().int().positive(),
});

const apiErrorSchema = z.object({
  status: z.literal("error"),
  message: z.string().optional(),
});

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;
type ResolvedExchangeRate = { rate: Prisma.Decimal; timestamp: Date | null };
type SupportedAsset = Parameters<MarketDataProvider["getCurrentPrices"]>[0]["assets"][number] & {
  quoteProvider: typeof AssetQuoteProvider.TWELVE_DATA;
  quoteSymbol: string;
  quoteMicCode: string;
};

export class TwelveDataMarketDataProvider implements MarketDataProvider {
  readonly name = "TWELVE_DATA";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveTwelveDataApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const supportedAssets = assets.filter(isSupportedAsset);
    if (supportedAssets.length === 0) return [];

    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!apiKey) return [];

    const quotes = await Promise.all(supportedAssets.map((asset) => this.fetchQuote(asset, apiKey)));
    const quoteCurrencies = [...new Set(quotes.map((quote) => quote.currency.toUpperCase()))];
    const fxEntries = await Promise.all(quoteCurrencies.map(async (currency): Promise<readonly [string, ResolvedExchangeRate]> => {
      if (currency === baseCurrency.toUpperCase()) {
        return [currency, { rate: new Prisma.Decimal(1), timestamp: null }];
      }
      const fx = await this.fetchExchangeRate(currency, baseCurrency, apiKey);
      return [currency, { rate: new Prisma.Decimal(fx.rate), timestamp: new Date(fx.timestamp * 1_000) }];
    }));
    const fxByCurrency = new Map<string, ResolvedExchangeRate>(fxEntries);

    return quotes.map<MarketPrice>((quote, index) => {
      const asset = supportedAssets[index];
      const quoteTimestamp = new Date((quote.last_quote_at ?? quote.timestamp) * 1_000);
      const fx = fxByCurrency.get(quote.currency.toUpperCase());
      if (!fx) throw new Error(`Twelve Data FX rate is missing for ${quote.currency}.`);
      const timestamp = fx.timestamp && fx.timestamp < quoteTimestamp ? fx.timestamp : quoteTimestamp;

      return {
        assetId: asset.id,
        symbol: asset.symbol,
        price: new Prisma.Decimal(quote.close).mul(fx.rate).toString(),
        currency: baseCurrency.toUpperCase(),
        timestamp,
        source: this.name,
      };
    });
  }

  private async fetchQuote(asset: SupportedAsset, apiKey: string) {
    const payload = await this.request("quote", {
      symbol: asset.quoteSymbol,
      mic_code: asset.quoteMicCode,
    }, apiKey);
    const quote = quoteSchema.parse(payload);
    if (
      quote.symbol.toUpperCase() !== asset.quoteSymbol.toUpperCase()
      || quote.mic_code.toUpperCase() !== asset.quoteMicCode.toUpperCase()
      || quote.currency.toUpperCase() !== asset.currency.toUpperCase()
    ) {
      throw new Error(`Twelve Data returned a different listing for ${asset.symbol}.`);
    }
    if (!new Prisma.Decimal(quote.close).greaterThan(0)) {
      throw new Error(`Twelve Data returned an invalid price for ${asset.symbol}.`);
    }
    return quote;
  }

  private async fetchExchangeRate(fromCurrency: string, toCurrency: string, apiKey: string) {
    const symbol = `${fromCurrency.toUpperCase()}/${toCurrency.toUpperCase()}`;
    const payload = await this.request("exchange_rate", { symbol }, apiKey);
    const rate = exchangeRateSchema.parse(payload);
    if (rate.symbol.toUpperCase() !== symbol) {
      throw new Error(`Twelve Data returned a different FX pair for ${symbol}.`);
    }
    return rate;
  }

  private async request(path: string, parameters: Record<string, string>, apiKey: string) {
    const url = new URL(`https://api.twelvedata.com/${path}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set("apikey", apiKey);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Twelve Data request failed with status ${response.status}.`);
    const payload: unknown = await response.json();
    if (apiErrorSchema.safeParse(payload).success) throw new Error("Twelve Data rejected the request.");
    return payload;
  }
}

function isSupportedAsset(asset: Parameters<MarketDataProvider["getCurrentPrices"]>[0]["assets"][number]): asset is SupportedAsset {
  return asset.assetType === AssetType.ETF
    && asset.quoteProvider === AssetQuoteProvider.TWELVE_DATA
    && Boolean(asset.quoteSymbol)
    && Boolean(asset.quoteMicCode);
}
