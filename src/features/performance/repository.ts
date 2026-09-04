import type { DailyMarketPrice, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DbClient } from "@/lib/db/types";

export type DailyPriceWrite = {
  assetId: string;
  currency: string;
  date: Date;
  price: string;
  source: string;
  quoteTimestamp: Date;
  capturedAt: Date;
  isStaleAtCapture: boolean;
};

export interface DailyMarketPriceStore {
  saveDailyPrices(prices: DailyPriceWrite[]): Promise<void>;
  listDailyPrices(currency: string): Promise<DailyMarketPrice[]>;
}

export class DailyMarketPriceRepository implements DailyMarketPriceStore {
  constructor(private readonly db: DbClient = prisma) {}

  async saveDailyPrices(prices: DailyPriceWrite[]) {
    if (prices.length === 0) return;

    const save = (price: DailyPriceWrite) => this.db.dailyMarketPrice.upsert({
        where: {
          assetId_currency_date: {
            assetId: price.assetId,
            currency: price.currency,
            date: price.date,
          },
        },
        update: {
          price: price.price,
          source: price.source,
          quoteTimestamp: price.quoteTimestamp,
          capturedAt: price.capturedAt,
          isStaleAtCapture: price.isStaleAtCapture,
        },
        create: price,
      });
    if (typeof (this.db as PrismaClient).$transaction === "function") {
      await (this.db as PrismaClient).$transaction(prices.map(save));
      return;
    }
    for (const price of prices) await save(price);
  }

  listDailyPrices(currency: string) {
    return this.db.dailyMarketPrice.findMany({
      where: { currency },
      orderBy: [{ date: "asc" }, { assetId: "asc" }],
    });
  }
}
