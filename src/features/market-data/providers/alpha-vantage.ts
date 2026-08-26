import { AssetQuoteProvider, AssetType, Prisma } from "@prisma/client";
import { z } from "zod";
import { resolveAlphaVantageApiKey } from "@/features/integrations/service";
import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

const dailySeriesSchema = z.object({
  "Meta Data": z.object({
    "2. Symbol": z.string().min(1),
  }),
  "Time Series (Daily)": z.record(z.string(), z.object({
    "4. close": z.string().regex(/^\d+(?:\.\d+)?$/),
  })),
});

const exchangeRateSchema = z.object({
  "Realtime Currency Exchange Rate": z.object({
    "1. From_Currency Code": z.string().length(3),
    "3. To_Currency Code": z.string().length(3),
    "5. Exchange Rate": z.string().regex(/^\d+(?:\.\d+)?$/),
    "6. Last Refreshed": z.string().min(10),
  }),
});

const apiProblemSchema = z.union([
  z.object({ "Error Message": z.string().min(1) }),
  z.object({ Note: z.string().min(1) }),
  z.object({ Information: z.string().min(1) }),
]);

type FetchLike = typeof fetch;
type ApiKeyResolver = () => Promise<string | undefined>;
type ResolvedExchangeRate = { rate: Prisma.Decimal; timestamp: Date };
type SupportedAsset = Parameters<MarketDataProvider["getCurrentPrices"]>[0]["assets"][number] & {
  quoteProvider: typeof AssetQuoteProvider.ALPHA_VANTAGE;
  quoteSymbol: string;
  quoteMicCode: string;
};

export class AlphaVantageMarketDataProvider implements MarketDataProvider {
  readonly name = "ALPHA_VANTAGE";

  constructor(
    private readonly apiKey: string | ApiKeyResolver | undefined = resolveAlphaVantageApiKey,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const supportedAssets = assets.filter(isSupportedAsset);
    if (supportedAssets.length === 0) return [];

    const apiKey = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    if (!apiKey) return [];

    const quotes = await Promise.all(supportedAssets.map((asset) => this.fetchDailyClose(asset, apiKey)));
    const quoteCurrencies = [...new Set(supportedAssets.map((asset) => asset.currency.toUpperCase()))];
    const fxEntries = await Promise.all(quoteCurrencies.map(async (currency): Promise<readonly [string, ResolvedExchangeRate]> => {
      if (currency === baseCurrency.toUpperCase()) {
        return [currency, { rate: new Prisma.Decimal(1), timestamp: new Date() }];
      }
      return [currency, await this.fetchExchangeRate(currency, baseCurrency, apiKey)];
    }));
    const fxByCurrency = new Map<string, ResolvedExchangeRate>(fxEntries);

    return quotes.map<MarketPrice>((quote, index) => {
      const asset = supportedAssets[index];
      const fx = fxByCurrency.get(asset.currency.toUpperCase());
      if (!fx) throw new Error(`Alpha Vantage FX rate is missing for ${asset.currency}.`);
      const timestamp = fx.timestamp < quote.timestamp ? fx.timestamp : quote.timestamp;

      return {
        assetId: asset.id,
        symbol: asset.symbol,
        price: quote.close.mul(fx.rate).toString(),
        currency: baseCurrency.toUpperCase(),
        timestamp,
        source: this.name,
      };
    });
  }

  private async fetchDailyClose(asset: SupportedAsset, apiKey: string) {
    const payload = await this.request({
      function: "TIME_SERIES_DAILY",
      symbol: asset.quoteSymbol,
      outputsize: "compact",
    }, apiKey);
    const parsed = dailySeriesSchema.parse(payload);
    if (parsed["Meta Data"]["2. Symbol"].toUpperCase() !== asset.quoteSymbol.toUpperCase()) {
      throw new Error(`Alpha Vantage returned a different listing for ${asset.symbol}.`);
    }

    const [latestDate, latest] = Object.entries(parsed["Time Series (Daily)"])
      .sort(([left], [right]) => right.localeCompare(left))[0] ?? [];
    if (!latestDate || !latest) throw new Error(`Alpha Vantage returned no daily prices for ${asset.symbol}.`);
    const close = new Prisma.Decimal(latest["4. close"]);
    if (!close.greaterThan(0)) throw new Error(`Alpha Vantage returned an invalid price for ${asset.symbol}.`);

    return { close, timestamp: new Date(`${latestDate}T23:59:59.000Z`) };
  }

  private async fetchExchangeRate(fromCurrency: string, toCurrency: string, apiKey: string) {
    const payload = await this.request({
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: fromCurrency.toUpperCase(),
      to_currency: toCurrency.toUpperCase(),
    }, apiKey);
    const parsed = exchangeRateSchema.parse(payload)["Realtime Currency Exchange Rate"];
    if (
      parsed["1. From_Currency Code"].toUpperCase() !== fromCurrency.toUpperCase()
      || parsed["3. To_Currency Code"].toUpperCase() !== toCurrency.toUpperCase()
    ) {
      throw new Error(`Alpha Vantage returned a different FX pair for ${fromCurrency}/${toCurrency}.`);
    }
    const timestamp = new Date(`${parsed["6. Last Refreshed"].replace(" ", "T")}.000Z`);
    if (Number.isNaN(timestamp.getTime())) throw new Error(`Alpha Vantage returned an invalid FX timestamp for ${fromCurrency}/${toCurrency}.`);
    return { rate: new Prisma.Decimal(parsed["5. Exchange Rate"]), timestamp };
  }

  private async request(parameters: Record<string, string>, apiKey: string) {
    const url = new URL("https://www.alphavantage.co/query");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set("apikey", apiKey);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Alpha Vantage request failed with status ${response.status}.`);
    const payload: unknown = await response.json();
    if (apiProblemSchema.safeParse(payload).success) throw new Error("Alpha Vantage rejected or throttled the request.");
    return payload;
  }
}

function isSupportedAsset(asset: Parameters<MarketDataProvider["getCurrentPrices"]>[0]["assets"][number]): asset is SupportedAsset {
  return asset.assetType === AssetType.ETF
    && asset.quoteProvider === AssetQuoteProvider.ALPHA_VANTAGE
    && Boolean(asset.quoteSymbol)
    && Boolean(asset.quoteMicCode);
}
