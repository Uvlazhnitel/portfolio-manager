import type { MarketDataProvider, MarketPrice } from "@/features/market-data/types";

export class BaseCurrencyMarketDataProvider implements MarketDataProvider {
  readonly name = "BASE_CURRENCY";

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const timestamp = new Date();

    return assets
      .filter((asset) => asset.symbol === baseCurrency && asset.currency === baseCurrency)
      .map<MarketPrice>((asset) => ({
        assetId: asset.id,
        symbol: asset.symbol,
        price: "1",
        currency: baseCurrency,
        timestamp,
        source: this.name,
      }));
  }
}
