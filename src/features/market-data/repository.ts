import type { CachedMarketPrice, ManualMarketPrice, MarketPriceUnit, PrismaClient } from "@prisma/client";
import type { MarketPrice } from "@/features/market-data/types";
import { prisma } from "@/lib/db/client";
import { runInTransaction } from "@/lib/db/transaction";
import type { DbClient } from "@/lib/db/types";

export type CachedPriceRecord = CachedMarketPrice;

export interface MarketDataStore {
  listCachedPrices(assetIds: string[], currency: string): Promise<CachedPriceRecord[]>;
  listManualPrices(currency: string): Promise<ManualMarketPrice[]>;
  saveCachedPrices(prices: MarketPrice[], fetchedAt: Date): Promise<void>;
}

export class MarketDataRepository implements MarketDataStore {
  constructor(private readonly db: DbClient = prisma) {}

  async withTransaction<T>(operation: (repository: MarketDataRepository) => Promise<T>) {
    if (typeof (this.db as PrismaClient).$transaction !== "function") {
      throw new Error("A root Prisma client is required to start a transaction.");
    }
    return runInTransaction(this.db as PrismaClient, (transaction) => (
      operation(new MarketDataRepository(transaction))
    ));
  }

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
    const save = (price: MarketPrice) => this.db.cachedMarketPrice.upsert({
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
      });
    if (typeof (this.db as PrismaClient).$transaction === "function") {
      await (this.db as PrismaClient).$transaction(prices.map(save));
      return;
    }
    for (const price of prices) await save(price);
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

  findAsset(id: string) {
    return this.db.asset.findUnique({ where: { id } });
  }
}
