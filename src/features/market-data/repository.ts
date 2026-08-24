import type { CachedMarketPrice, ManualMarketPrice, MarketPriceUnit, PrismaClient } from "@prisma/client";
import type { MarketPrice } from "@/features/market-data/types";
import { prisma } from "@/lib/db/client";

export type CachedPriceRecord = CachedMarketPrice;

export interface MarketDataStore {
  listCachedPrices(assetIds: string[], currency: string): Promise<CachedPriceRecord[]>;
  listManualPrices(currency: string): Promise<ManualMarketPrice[]>;
  saveCachedPrices(prices: MarketPrice[], fetchedAt: Date): Promise<void>;
}

export class MarketDataRepository implements MarketDataStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  listCachedPrices(assetIds: string[], currency: string) {
    return this.db.cachedMarketPrice.findMany({
      where: { assetId: { in: assetIds }, currency },
    });
  }

  listManualPrices(currency: string) {
    return this.db.manualMarketPrice.findMany({
      where: { currency },
      orderBy: { updatedAt: "desc" },
    });
  }

  async saveCachedPrices(prices: MarketPrice[], fetchedAt: Date) {
    await this.db.$transaction(
      prices.map((price) => this.db.cachedMarketPrice.upsert({
        where: {
          assetId_currency: { assetId: price.assetId, currency: price.currency },
        },
        update: {
          price: price.price,
          timestamp: price.timestamp,
          fetchedAt,
          source: price.source,
        },
        create: {
          assetId: price.assetId,
          currency: price.currency,
          price: price.price,
          timestamp: price.timestamp,
          fetchedAt,
          source: price.source,
        },
      })),
    );
  }

  upsertManualPrice(input: {
    assetId: string;
    currency: string;
    price: string;
    unit: MarketPriceUnit;
  }) {
    return this.db.manualMarketPrice.upsert({
      where: { assetId_currency: { assetId: input.assetId, currency: input.currency } },
      update: { price: input.price, unit: input.unit },
      create: input,
      include: { asset: true },
    });
  }

  listAssetsWithManualPrices(currency: string) {
    return this.db.asset.findMany({
      include: {
        manualPrices: { where: { currency } },
      },
      orderBy: { symbol: "asc" },
    });
  }
}
