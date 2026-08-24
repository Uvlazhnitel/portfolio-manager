import type { PrismaClient } from "@prisma/client";
import { normalizeManualPrice } from "@/features/market-data/providers/manual";
import { MarketDataRepository } from "@/features/market-data/repository";
import {
  manualMarketPriceSchema,
  type ManualMarketPriceInput,
} from "@/features/market-data/validation";
import { prisma } from "@/lib/db/client";

export type MarketDataMutationResult = { ok: boolean; message: string };

export async function saveManualMarketPriceMutation(
  input: ManualMarketPriceInput,
  db: PrismaClient = prisma,
): Promise<MarketDataMutationResult> {
  const parsed = manualMarketPriceSchema.parse(input);
  const asset = await db.asset.findUnique({ where: { id: parsed.assetId } });

  if (!asset) {
    throw new Error("Selected asset does not exist.");
  }

  const normalizedPrice = normalizeManualPrice(asset.assetType, parsed.price, parsed.unit);
  const repository = new MarketDataRepository(db);
  const manualPrice = await repository.upsertManualPrice(parsed);

  await repository.saveCachedPrices([{
    assetId: asset.id,
    symbol: asset.symbol,
    price: normalizedPrice.toString(),
    currency: parsed.currency,
    timestamp: manualPrice.updatedAt,
    source: "MANUAL",
  }], manualPrice.updatedAt);

  return { ok: true, message: "Manual price saved." };
}
