import { AssetClass, AssetType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillCoinGeckoLogos } from "@/features/assets/coingecko-logo-backfill";
import { AssetRepository } from "@/features/assets/repository";
import type { MarketDataService } from "@/features/market-data/service";
import { getPortfolioReadModel } from "@/features/portfolio/read-model";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

describe("CoinGecko logo backfill", () => {
  it("adds missing CoinGecko image metadata without overwriting existing logos", async () => {
    const [btc, eth, custom] = await Promise.all([
      testDb.prisma.asset.create({
        data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: "bitcoin" },
      }),
      testDb.prisma.asset.create({
        data: {
          symbol: "ETH",
          name: "Ethereum",
          assetClass: AssetClass.CRYPTO,
          assetType: AssetType.CRYPTO,
          currency: "ETH",
          externalId: "ethereum",
          metadata: { imageUrl: "https://assets.coingecko.com/custom/eth.png" },
        },
      }),
      testDb.prisma.asset.create({
        data: { symbol: "CUSTOM", name: "Custom", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "USD" },
      }),
    ]);
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { id: "bitcoin", image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png" },
      { id: "ethereum", image: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png" },
    ])));

    const result = await backfillCoinGeckoLogos({ repository: new AssetRepository(testDb.prisma), fetcher, apiKey: "" });

    expect(result).toEqual({ scanned: 2, updated: 1, skipped: 1, missing: [], warnings: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { id: btc.id } })).resolves.toEqual(
      expect.objectContaining({ metadata: { imageUrl: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png" } }),
    );
    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { id: eth.id } })).resolves.toEqual(
      expect.objectContaining({ metadata: { imageUrl: "https://assets.coingecko.com/custom/eth.png" } }),
    );
    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { id: custom.id } })).resolves.toEqual(
      expect.objectContaining({ metadata: null }),
    );
  });

  it("ignores unsafe logo URLs and exposes portfolio images after backfill", async () => {
    await testDb.prisma.asset.create({
      data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: "bitcoin" },
    });
    await testDb.prisma.asset.create({
      data: { symbol: "XAUT", name: "Tether Gold", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD, currency: "XAUT", externalId: "tether-gold" },
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { id: "bitcoin", image: "http://coin-images.coingecko.com/unsafe.png" },
      { id: "tether-gold", image: "https://coin-images.coingecko.com/coins/images/10481/large/tether-gold.png" },
    ])));

    const result = await backfillCoinGeckoLogos({ repository: new AssetRepository(testDb.prisma), fetcher, apiKey: "" });
    const portfolio = await getPortfolioReadModel({
      repository: new PortfolioRepository(testDb.prisma),
      strategyRepository: new StrategyRepository(testDb.prisma),
      marketDataService: {
        getCurrentPrices: async () => ({
          prices: [],
          unavailableAssetIds: [],
          lastUpdated: null,
          hasStalePrices: false,
          warning: null,
          wasRefreshed: false,
          refreshBlockedUntil: null,
        }),
      } as unknown as MarketDataService,
    });

    expect(result).toEqual({ scanned: 2, updated: 1, skipped: 0, missing: ["BTC"], warnings: [] });
    expect(portfolio.assets.find((asset) => asset.symbol === "XAUT")?.imageUrl).toBe("https://coin-images.coingecko.com/coins/images/10481/large/tether-gold.png");
    expect(portfolio.assets.find((asset) => asset.symbol === "BTC")?.imageUrl).toBeNull();
  });
});
