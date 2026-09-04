import type { AssetQuoteProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DbClient } from "@/lib/db/types";

export type AssetCreateRecord = {
  symbol: string;
  name: string;
  assetClass: Prisma.AssetCreateInput["assetClass"];
  assetType: Prisma.AssetCreateInput["assetType"];
  currency: string;
  externalId?: string | null;
  quoteProvider?: AssetQuoteProvider | null;
  quoteSymbol?: string | null;
  quoteMicCode?: string | null;
  metadata?: unknown;
};

export class AssetRepository {
  constructor(private readonly db: DbClient = prisma) {}

  findById(id: string) {
    return this.db.asset.findUnique({ where: { id } });
  }

  findBySymbol(symbol: string) {
    return this.db.asset.findUnique({ where: { symbol } });
  }

  findByExternalId(externalId: string) {
    return this.db.asset.findFirst({ where: { externalId } });
  }

  findByQuoteIdentity(input: {
    quoteProvider: AssetQuoteProvider;
    quoteSymbol: string;
    quoteMicCode?: string | null;
  }) {
    const where = input.quoteProvider === "ALPHA_VANTAGE"
      ? { quoteProvider: input.quoteProvider, quoteSymbol: input.quoteSymbol }
      : {
          quoteProvider: input.quoteProvider,
          quoteSymbol: input.quoteSymbol,
          quoteMicCode: input.quoteMicCode ?? null,
        };
    return this.db.asset.findFirst({ where });
  }

  create(input: AssetCreateRecord) {
    return this.db.asset.create({
      data: { ...input, metadata: input.metadata as Prisma.InputJsonValue | undefined },
    });
  }

  updateQuoteLink(input: {
    id: string;
    currency: string;
    quoteProvider: AssetQuoteProvider;
    quoteSymbol: string;
    quoteMicCode?: string | null;
  }) {
    return this.db.asset.update({
      where: { id: input.id },
      data: {
        currency: input.currency,
        quoteProvider: input.quoteProvider,
        quoteSymbol: input.quoteSymbol,
        quoteMicCode: input.quoteMicCode,
      },
    });
  }

  clearCachedPrices(assetId: string) {
    return this.db.cachedMarketPrice.deleteMany({ where: { assetId } });
  }

  listWithExternalId() {
    return this.db.asset.findMany({
      where: { externalId: { not: null } },
      select: { id: true, symbol: true, externalId: true, metadata: true },
      orderBy: { symbol: "asc" },
    });
  }

  updateMetadata(id: string, metadata: Prisma.InputJsonValue) {
    return this.db.asset.update({ where: { id }, data: { metadata } });
  }
}
