import { AssetType, MarketPriceUnit } from "@prisma/client";
import { decimal } from "@/features/portfolio-engine/decimal";
import { goldPricePerGram } from "@/features/market-data/gold";
import type {
  ManualPriceRecord,
  MarketDataProvider,
  MarketPrice,
} from "@/features/market-data/types";

export class ManualMarketDataProvider implements MarketDataProvider {
  readonly name = "MANUAL";

  constructor(private readonly loadPrices: (currency: string) => Promise<ManualPriceRecord[]>) {}

  async getCurrentPrices({ assets, baseCurrency }: Parameters<MarketDataProvider["getCurrentPrices"]>[0]) {
    const manualPrices = await this.loadPrices(baseCurrency);
    const pricesByAsset = new Map(manualPrices.map((price) => [price.assetId, price]));

    return assets.flatMap<MarketPrice>((asset) => {
      const manual = pricesByAsset.get(asset.id);
      if (!manual) {
        return [];
      }

      const price = normalizeManualPrice(asset.assetType, manual.price, manual.unit);

      return [{
        assetId: asset.id,
        symbol: asset.symbol,
        price: price.toString(),
        currency: baseCurrency,
        timestamp: manual.updatedAt,
        source: this.name,
      }];
    });
  }
}

export function normalizeManualPrice(assetType: AssetType, price: string, unit: MarketPriceUnit) {
  if (assetType === AssetType.PHYSICAL_GOLD) {
    if (unit !== MarketPriceUnit.GRAM && unit !== MarketPriceUnit.TROY_OUNCE) {
      throw new Error("Physical gold price must be quoted per gram or troy ounce.");
    }

    return goldPricePerGram(price, unit);
  }

  if (unit !== MarketPriceUnit.ASSET_UNIT) {
    throw new Error("This asset price must be quoted per asset unit.");
  }

  return decimal(price);
}
