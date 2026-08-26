import "dotenv/config";
import {
  AccountType,
  AssetClass,
  AssetQuoteProvider,
  AssetType,
  PortfolioRuleType,
  PrismaClient,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateStrategyAllocations } from "../src/features/strategy/validation";
import { backfillStrategyAssetAllocations } from "../src/features/strategy/asset-target-backfill";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run the seed script.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(databaseUrl),
});

const strategyAllocations = [
  { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "72", maxPercent: "82" },
  { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
  { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
  { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
];

async function main() {
  await Promise.all([
    prisma.account.upsert({
      where: { name: "Bybit" },
      update: {},
      create: { name: "Bybit", type: AccountType.EXCHANGE },
    }),
    prisma.account.upsert({
      where: { name: "Physical Storage" },
      update: {},
      create: { name: "Physical Storage", type: AccountType.PHYSICAL },
    }),
    prisma.account.upsert({
      where: { name: "Future Broker" },
      update: {},
      create: { name: "Future Broker", type: AccountType.BROKER },
    }),
  ]);

  await Promise.all([
    prisma.asset.upsert({
      where: { symbol: "VWCE" },
      update: {},
      create: {
        symbol: "VWCE",
        name: "Vanguard FTSE All-World UCITS ETF",
        assetClass: AssetClass.ETF,
        assetType: AssetType.ETF,
        currency: "EUR",
        quoteProvider: AssetQuoteProvider.TWELVE_DATA,
        quoteSymbol: "VWCE",
        quoteMicCode: "XETR",
      },
    }),
    prisma.asset.upsert({
      where: { symbol: "BTC" },
      update: { externalId: "bitcoin" },
      create: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC", externalId: "bitcoin" },
    }),
    prisma.asset.upsert({
      where: { symbol: "ETH" },
      update: { externalId: "ethereum" },
      create: { symbol: "ETH", name: "Ethereum", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "ETH", externalId: "ethereum" },
    }),
    prisma.asset.upsert({
      where: { symbol: "XAUT" },
      update: { externalId: "tether-gold" },
      create: { symbol: "XAUT", name: "Tether Gold", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD, currency: "XAUT", externalId: "tether-gold" },
    }),
    prisma.asset.upsert({
      where: { symbol: "PHYSICAL_GOLD" },
      update: {},
      create: { symbol: "PHYSICAL_GOLD", name: "Physical Gold", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD, currency: "XAU" },
    }),
    prisma.asset.upsert({
      where: { symbol: "USD" },
      update: {},
      create: { symbol: "USD", name: "US Dollar", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" },
    }),
    prisma.asset.upsert({
      where: { symbol: "EUR" },
      update: {},
      create: { symbol: "EUR", name: "Euro", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" },
    }),
    prisma.asset.upsert({
      where: { symbol: "USDT" },
      update: { externalId: "tether" },
      create: { symbol: "USDT", name: "Tether USD", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USDT", externalId: "tether" },
    }),
  ]);

  const seededAssets = await prisma.asset.findMany({
    where: { symbol: { in: ["VWCE", "BTC", "ETH", "PHYSICAL_GOLD", "XAUT", "USD", "EUR", "USDT"] } },
  });
  const assetIdBySymbol = new Map(seededAssets.map((asset) => [asset.symbol, asset.id]));
  const requireAssetId = (symbol: string) => {
    const assetId = assetIdBySymbol.get(symbol);
    if (!assetId) throw new Error(`Seed asset ${symbol} was not created.`);
    return assetId;
  };
  const strategyAllocationsWithAssetTargets = [
    {
      ...strategyAllocations[0],
      assetTargets: [{ assetId: requireAssetId("VWCE"), targetPercent: "100" }],
    },
    {
      ...strategyAllocations[1],
      assetTargets: [
        { assetId: requireAssetId("BTC"), targetPercent: "70" },
        { assetId: requireAssetId("ETH"), targetPercent: "30" },
      ],
    },
    {
      ...strategyAllocations[2],
      assetTargets: [
        { assetId: requireAssetId("PHYSICAL_GOLD"), targetPercent: "60" },
        { assetId: requireAssetId("XAUT"), targetPercent: "40" },
      ],
    },
    {
      ...strategyAllocations[3],
      assetTargets: [
        { assetId: requireAssetId("USD"), targetPercent: "50" },
        { assetId: requireAssetId("EUR"), targetPercent: "25" },
        { assetId: requireAssetId("USDT"), targetPercent: "25" },
      ],
    },
  ];
  validateStrategyAllocations(strategyAllocationsWithAssetTargets);

  const strategy = await prisma.strategy.upsert({
    where: { id: "default-strategy" },
    update: {},
    create: {
      id: "default-strategy",
      name: "Long-term capital growth",
      objective: "Grow long-term capital while keeping allocations close to configurable target ranges.",
      baseCurrency: "USD",
    },
  });

  for (const allocation of strategyAllocationsWithAssetTargets) {
    const strategyAllocation = await prisma.strategyAllocation.upsert({
      where: {
        strategyId_assetClass: {
          strategyId: strategy.id,
          assetClass: allocation.assetClass,
        },
      },
      update: {},
      create: {
        strategyId: strategy.id,
        assetClass: allocation.assetClass,
        targetPercent: allocation.targetPercent,
        minPercent: allocation.minPercent,
        maxPercent: allocation.maxPercent,
      },
    });

    for (const assetTarget of allocation.assetTargets) {
      await prisma.strategyAssetAllocation.upsert({
        where: {
          strategyAllocationId_assetId: {
            strategyAllocationId: strategyAllocation.id,
            assetId: assetTarget.assetId,
          },
        },
        update: { targetPercent: assetTarget.targetPercent },
        create: {
          strategyAllocationId: strategyAllocation.id,
          assetId: assetTarget.assetId,
          targetPercent: assetTarget.targetPercent,
        },
      });
    }
  }

  const rules = [
    { type: PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING, config: { enabledByDefault: true } },
    { type: PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS, config: { severity: "medium" } },
    { type: PortfolioRuleType.PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK, config: {} },
    { type: PortfolioRuleType.MIN_REBALANCE_DRIFT, config: { minDriftPercent: "2" } },
  ];

  for (const rule of rules) {
    await prisma.portfolioRule.upsert({
      where: {
        strategyId_type: {
          strategyId: strategy.id,
          type: rule.type,
        },
      },
      update: {},
      create: {
        strategyId: strategy.id,
        enabled: true,
        ...rule,
      },
    });
  }

  await backfillStrategyAssetAllocations(prisma);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(`Seed failed (${error instanceof Error ? error.name : "unknown error"}). Verify the database connection and migration state.`);
    process.exit(1);
  });
