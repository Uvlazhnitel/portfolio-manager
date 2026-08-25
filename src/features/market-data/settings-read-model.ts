import { serializeDecimal } from "@/lib/db/decimal";
import { MarketDataRepository } from "@/features/market-data/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export async function getMarketDataSettingsReadModel(
  repository = new MarketDataRepository(),
  currency: string = DEFAULT_BASE_CURRENCY,
) {
  const assets = await repository.listAssetsWithManualPrices(currency);

  return assets.map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    assetType: asset.assetType,
    manualPrice: asset.manualPrices[0]
      ? {
          price: serializeDecimal(asset.manualPrices[0].price),
          currency: asset.manualPrices[0].currency,
          unit: asset.manualPrices[0].unit,
          updatedAt: asset.manualPrices[0].updatedAt.toISOString(),
        }
      : null,
  }));
}

export type MarketDataSettingsModel = Awaited<ReturnType<typeof getMarketDataSettingsReadModel>>;
