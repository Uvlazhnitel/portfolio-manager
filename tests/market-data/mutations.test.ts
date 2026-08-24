import { AssetClass, AssetType, MarketPriceUnit } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveManualMarketPriceMutation } from "@/features/market-data/mutations";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("manual market price mutation", () => {
  it("stores the original gold quote and caches a normalized EUR price per gram", async () => {
    const gold = await testDb.prisma.asset.create({
      data: {
        symbol: "PHYSICAL_GOLD",
        name: "Physical Gold",
        assetClass: AssetClass.GOLD,
        assetType: AssetType.PHYSICAL_GOLD,
        currency: "XAU",
      },
    });

    await saveManualMarketPriceMutation({
      assetId: gold.id,
      price: "3110.34768",
      currency: "EUR",
      unit: MarketPriceUnit.TROY_OUNCE,
    }, testDb.prisma);

    const manual = await testDb.prisma.manualMarketPrice.findFirstOrThrow({ where: { assetId: gold.id } });
    const cached = await testDb.prisma.cachedMarketPrice.findFirstOrThrow({ where: { assetId: gold.id } });
    expect(manual.price.toString()).toBe("3110.34768");
    expect(manual.unit).toBe(MarketPriceUnit.TROY_OUNCE);
    expect(cached.price.toString()).toBe("100");
    expect(cached.source).toBe("MANUAL");
  });

  it("rejects non-positive and incompatible manual prices", async () => {
    const etf = await testDb.prisma.asset.create({
      data: { symbol: "VWCE", name: "VWCE", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" },
    });

    await expect(saveManualMarketPriceMutation({
      assetId: etf.id,
      price: "0",
      currency: "EUR",
      unit: MarketPriceUnit.ASSET_UNIT,
    }, testDb.prisma)).rejects.toThrow();

    await expect(saveManualMarketPriceMutation({
      assetId: etf.id,
      price: "100",
      currency: "EUR",
      unit: MarketPriceUnit.GRAM,
    }, testDb.prisma)).rejects.toThrow("per asset unit");
  });
});
