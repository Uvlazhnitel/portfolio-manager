import { AccountType, AssetClass, AssetType, PortfolioRuleType, TransactionType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateHoldings } from "@/features/portfolio-engine";
import {
  createAccountMutation,
  createPhysicalGoldInitialBalanceInput,
  createTransactionMutation,
  deleteTransactionMutation,
} from "@/features/portfolio/mutations";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;

async function seedBasics() {
  const [account, storage] = await Promise.all([
    testDb.prisma.account.create({ data: { name: "Bybit", type: AccountType.EXCHANGE } }),
    testDb.prisma.account.create({ data: { name: "Physical Storage", type: AccountType.PHYSICAL } }),
  ]);
  const [btc, gold] = await Promise.all([
    testDb.prisma.asset.create({
      data: { symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    }),
    testDb.prisma.asset.create({
      data: {
        symbol: "PHYSICAL_GOLD",
        name: "Physical Gold",
        assetClass: AssetClass.GOLD,
        assetType: AssetType.PHYSICAL_GOLD,
        currency: "XAU",
      },
    }),
  ]);

  return { account, storage, btc, gold };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("portfolio mutations", () => {
  it("creates accounts", async () => {
    const result = await createAccountMutation({ name: "Future Broker", type: AccountType.BROKER }, testDb.prisma);
    const account = await testDb.prisma.account.findUnique({ where: { name: "Future Broker" } });

    expect(result.ok).toBe(true);
    expect(account?.type).toBe(AccountType.BROKER);
  });

  it("creates initial balance transactions", async () => {
    const { account, btc } = await seedBasics();

    await createTransactionMutation(
      {
        type: TransactionType.INITIAL_BALANCE,
        accountId: account.id,
        assetMode: "existing",
        assetId: btc.id,
        quantity: "1.25",
        pricePerUnit: "10000",
        currency: "EUR",
        executedAt: new Date("2026-01-01"),
      },
      testDb.prisma,
    );

    const transactions = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: btc.id } });
    expect(calculateHoldings(transactions)).toEqual([{ accountId: account.id, assetId: btc.id, quantity: "1.25" }]);
  });

  it("creates buy transactions", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await createTransactionMutation(
      {
        type: TransactionType.BUY,
        accountId: account.id,
        assetMode: "existing",
        assetId: btc.id,
        quantity: "0.5",
        pricePerUnit: "12000",
        fee: "3",
        currency: "EUR",
        executedAt: new Date("2026-01-02"),
      },
      testDb.prisma,
    );

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({ where: { type: TransactionType.BUY } });
    expect(transaction.pricePerUnit?.toString()).toBe("12000");
    expect(transaction.fee?.toString()).toBe("3");
  });

  it("rejects selling more than account quantity without override", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(
      createTransactionMutation(
        {
          type: TransactionType.SELL,
          accountId: account.id,
          assetMode: "existing",
          assetId: btc.id,
          quantity: "100",
          pricePerUnit: "15000",
          currency: "EUR",
          executedAt: new Date("2026-01-03"),
        },
        testDb.prisma,
      ),
    ).rejects.toThrow("Cannot sell more than the current account holding without override.");
  });

  it("allows selling more than account quantity with override", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    const result = await createTransactionMutation(
      {
        type: TransactionType.SELL,
        accountId: account.id,
        assetMode: "existing",
        assetId: btc.id,
        quantity: "100",
        pricePerUnit: "15000",
        currency: "EUR",
        executedAt: new Date("2026-01-04"),
        allowOversell: true,
      },
      testDb.prisma,
    );

    expect(result.ok).toBe(true);
  });

  it("normalizes physical gold grams and total purchase cost to price per gram", async () => {
    const storage = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Physical Storage" } });
    const gold = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "PHYSICAL_GOLD" } });

    await createTransactionMutation(
      createPhysicalGoldInitialBalanceInput({
        accountId: storage.id,
        physicalGoldAssetId: gold.id,
        weightGrams: "100",
        totalPurchaseCost: "6250",
        executedAt: new Date("2026-01-05"),
      }),
      testDb.prisma,
    );

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: storage.id, assetId: gold.id },
    });
    expect(transaction.quantity.toString()).toBe("100");
    expect(transaction.pricePerUnit?.toString()).toBe("62.5");
  });

  it("deletes transactions and lets holdings recalculate", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    const transaction = await testDb.prisma.transaction.create({
      data: {
        accountId: account.id,
        assetId: btc.id,
        type: TransactionType.INITIAL_BALANCE,
        quantity: "2",
        currency: "EUR",
        executedAt: new Date("2026-01-06"),
      },
    });

    await deleteTransactionMutation(transaction.id, testDb.prisma);

    const transactions = await testDb.prisma.transaction.findMany({ where: { id: transaction.id } });
    expect(transactions).toHaveLength(0);
  });

  it("creates a new asset and transaction together", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });

    await createTransactionMutation(
      {
        type: TransactionType.INITIAL_BALANCE,
        accountId: account.id,
        assetMode: "new",
        newAsset: {
          symbol: "VWCE",
          name: "Vanguard FTSE All-World",
          assetClass: AssetClass.ETF,
          assetType: AssetType.ETF,
          currency: "EUR",
        },
        quantity: "10",
        pricePerUnit: "120",
        currency: "EUR",
        executedAt: new Date("2026-01-07"),
      },
      testDb.prisma,
    );

    const asset = await testDb.prisma.asset.findUnique({ where: { symbol: "VWCE" } });
    const transaction = await testDb.prisma.transaction.findFirst({ where: { assetId: asset?.id } });

    expect(asset?.assetClass).toBe(AssetClass.ETF);
    expect(transaction?.quantity.toString()).toBe("10");
  });

  it("does not mutate an existing asset when a new-asset symbol collides", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const before = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });

    await expect(createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: account.id,
      assetMode: "new",
      newAsset: { symbol: "btc", name: "Wrong asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
      quantity: "1",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2026-01-08"),
    }, testDb.prisma)).rejects.toThrow("already exists");

    const after = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    expect(after).toEqual(before);
  });

  it("rolls back a new asset when its transaction cannot be created", async () => {
    await expect(createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: "missing-account",
      assetMode: "new",
      newAsset: { symbol: "ROLLBACK", name: "Rollback Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
      quantity: "1",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2026-01-08"),
    }, testDb.prisma)).rejects.toThrow("Selected account does not exist");

    expect(await testDb.prisma.asset.findUnique({ where: { symbol: "ROLLBACK" } })).toBeNull();
  });

  it("serializes concurrent sells so the account cannot oversell accidentally", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Concurrent Wallet", type: AccountType.WALLET } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: "CONCURRENT", name: "Concurrent Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: "1", currency: "EUR", executedAt: new Date("2026-01-01") },
    });
    const sell = () => createTransactionMutation({
      type: TransactionType.SELL,
      accountId: account.id,
      assetMode: "existing",
      assetId: asset.id,
      quantity: "0.75",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2026-01-09"),
    }, testDb.prisma);

    const results = await Promise.allSettled([sell(), sell()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("enforces database constraints and relation delete policies", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0", pricePerUnit: "1", currency: "EUR", executedAt: new Date() },
    })).rejects.toThrow();
    await expect(testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: btc.id, type: TransactionType.BUY, quantity: "1", pricePerUnit: "1", fee: "-1", currency: "EUR", executedAt: new Date() },
    })).rejects.toThrow();
    await expect(testDb.prisma.asset.delete({ where: { id: btc.id } })).rejects.toThrow();
    await expect(testDb.prisma.account.delete({ where: { id: account.id } })).rejects.toThrow();

    const disposable = await testDb.prisma.asset.create({
      data: { symbol: "DISPOSABLE", name: "Disposable", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    await expect(testDb.prisma.cachedMarketPrice.create({
      data: { assetId: disposable.id, currency: "EUR", price: "0", timestamp: new Date(), source: "TEST" },
    })).rejects.toThrow();
    await testDb.prisma.cachedMarketPrice.create({
      data: { assetId: disposable.id, currency: "EUR", price: "1", timestamp: new Date(), source: "TEST" },
    });
    await testDb.prisma.asset.delete({ where: { id: disposable.id } });
    expect(await testDb.prisma.cachedMarketPrice.count({ where: { assetId: disposable.id } })).toBe(0);

    const strategy = await testDb.prisma.strategy.create({ data: { name: "Disposable Strategy", objective: "Test", baseCurrency: "EUR" } });
    await expect(testDb.prisma.strategyAllocation.create({
      data: { strategyId: strategy.id, assetClass: AssetClass.ETF, minPercent: "80", targetPercent: "70", maxPercent: "90" },
    })).rejects.toThrow();
    await expect(testDb.prisma.contributionPlan.create({
      data: { strategyId: strategy.id, contributionAmount: "0", currency: "EUR", allocations: [], isCustomized: false },
    })).rejects.toThrow();
    await testDb.prisma.strategyAllocation.create({
      data: { strategyId: strategy.id, assetClass: AssetClass.ETF, minPercent: "60", targetPercent: "70", maxPercent: "80" },
    });
    await testDb.prisma.portfolioRule.create({
      data: { strategyId: strategy.id, type: PortfolioRuleType.MIN_REBALANCE_DRIFT, enabled: true, config: { minDriftPercent: "2" } },
    });
    await testDb.prisma.contributionPlan.create({
      data: { strategyId: strategy.id, contributionAmount: "100", currency: "EUR", allocations: [], isCustomized: false },
    });
    await testDb.prisma.strategy.delete({ where: { id: strategy.id } });
    expect(await testDb.prisma.strategyAllocation.count({ where: { strategyId: strategy.id } })).toBe(0);
    expect(await testDb.prisma.portfolioRule.count({ where: { strategyId: strategy.id } })).toBe(0);
    expect(await testDb.prisma.contributionPlan.count({ where: { strategyId: strategy.id } })).toBe(0);
  });
});
