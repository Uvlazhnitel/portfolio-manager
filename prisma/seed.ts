import "dotenv/config";
import {
  AccountType,
  AssetClass,
  AssetType,
  PortfolioRuleType,
  PrismaClient,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateStrategyAllocations } from "../src/features/strategy/validation";

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
  validateStrategyAllocations(strategyAllocations);

  await Promise.all([
    prisma.account.upsert({
      where: { name: "Bybit" },
      update: { type: AccountType.EXCHANGE },
      create: { name: "Bybit", type: AccountType.EXCHANGE },
    }),
    prisma.account.upsert({
      where: { name: "Physical Storage" },
      update: { type: AccountType.PHYSICAL },
      create: { name: "Physical Storage", type: AccountType.PHYSICAL },
    }),
    prisma.account.upsert({
      where: { name: "Future Broker" },
      update: { type: AccountType.BROKER },
      create: { name: "Future Broker", type: AccountType.BROKER },
    }),
  ]);

  await Promise.all([
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

  const strategy = await prisma.strategy.upsert({
    where: { id: "default-strategy" },
    update: {
      name: "Long-term capital growth",
      objective: "Grow long-term capital while keeping allocations close to configurable target ranges.",
      baseCurrency: "EUR",
    },
    create: {
      id: "default-strategy",
      name: "Long-term capital growth",
      objective: "Grow long-term capital while keeping allocations close to configurable target ranges.",
      baseCurrency: "EUR",
    },
  });

  for (const allocation of strategyAllocations) {
    await prisma.strategyAllocation.upsert({
      where: {
        strategyId_assetClass: {
          strategyId: strategy.id,
          assetClass: allocation.assetClass,
        },
      },
      update: {
        targetPercent: allocation.targetPercent,
        minPercent: allocation.minPercent,
        maxPercent: allocation.maxPercent,
      },
      create: {
        strategyId: strategy.id,
        ...allocation,
      },
    });
  }

  const rules = [
    { type: PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING, config: { enabledByDefault: true } },
    { type: PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS, config: { severity: "medium" } },
    { type: PortfolioRuleType.CRYPTO_MAX_ALLOCATION, config: { maxPercent: "15" } },
    { type: PortfolioRuleType.MIN_REBALANCE_DRIFT, config: { minDriftPercent: "5" } },
  ];

  for (const rule of rules) {
    await prisma.portfolioRule.upsert({
      where: {
        strategyId_type: {
          strategyId: strategy.id,
          type: rule.type,
        },
      },
      update: {
        enabled: true,
        config: rule.config,
      },
      create: {
        strategyId: strategy.id,
        enabled: true,
        ...rule,
      },
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
