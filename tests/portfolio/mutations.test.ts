import { AccountType, AssetClass, AssetQuoteProvider, AssetType, PortfolioRuleType, TransactionType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateHoldings } from "@/features/portfolio-engine";
import {
  createAccountMutation,
  createPhysicalGoldInitialBalanceInput,
  createTransferMutation,
  createTransactionMutation,
  deleteTransactionMutation,
  linkAssetQuoteMutation,
  updateTransactionMutation,
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

  it("normalizes total invested to an average acquisition price", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: account.id,
      assetMode: "existing",
      assetId: btc.id,
      quantity: "0.25",
      totalPurchaseCost: "12000",
      currency: "EUR",
      executedAt: new Date("2026-01-01T12:00:00Z"),
    }, testDb.prisma);

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: account.id, assetId: btc.id, quantity: "0.25" },
    });
    expect(transaction.pricePerUnit?.toString()).toBe("48000");
  });

  it("reuses an existing asset with the same external catalog id", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const existing = await testDb.prisma.asset.create({
      data: { symbol: "SOL", name: "Solana", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "SOL", externalId: "solana" },
    });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: account.id,
      assetMode: "new",
      newAsset: { symbol: "SOLANA", name: "Untrusted duplicate name", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "SOL", externalId: "solana" },
      quantity: "5",
      currency: "EUR",
      executedAt: new Date("2026-01-01T12:00:00Z"),
    }, testDb.prisma);

    expect(await testDb.prisma.asset.count({ where: { externalId: "solana" } })).toBe(1);
    expect(await testDb.prisma.transaction.count({ where: { assetId: existing.id, quantity: "5" } })).toBe(1);
  });

  it("persists a selected Alpha Vantage listing when creating an ETF", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "ETF Broker", type: AccountType.BROKER } });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: account.id,
      assetMode: "new",
      newAsset: {
        symbol: "IWDA",
        name: "iShares Core MSCI World UCITS ETF",
        assetClass: AssetClass.ETF,
        assetType: AssetType.ETF,
        currency: "EUR",
        quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
        quoteSymbol: "IWDA.AMS",
        quoteMicCode: "XAMS",
      },
      quantity: "2",
      totalAmount: "200",
      currency: "USD",
      executedAt: new Date("2026-01-01"),
    }, testDb.prisma);

    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "IWDA" } })).resolves.toMatchObject({
      currency: "EUR",
      quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
      quoteSymbol: "IWDA.AMS",
      quoteMicCode: "XAMS",
    });
  });

  it("persists an Alpha Vantage ETF listing without MIC metadata", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "No MIC Broker", type: AccountType.BROKER } });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      accountId: account.id,
      assetMode: "new",
      newAsset: {
        symbol: "TEST",
        name: "Test UCITS ETF",
        assetClass: AssetClass.ETF,
        assetType: AssetType.ETF,
        currency: "USD",
        quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
        quoteSymbol: "TEST.UNKNOWN",
        quoteMicCode: null,
      },
      quantity: "2",
      totalAmount: "200",
      currency: "USD",
      executedAt: new Date("2026-01-01"),
    }, testDb.prisma);

    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "TEST" } })).resolves.toMatchObject({
      quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
      quoteSymbol: "TEST.UNKNOWN",
      quoteMicCode: null,
    });
  });

  it("remaps an existing ETF listing and clears its cached quote", async () => {
    const etf = await testDb.prisma.asset.create({
      data: { symbol: "CSPX", name: "iShares Core S&P 500 UCITS ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" },
    });
    await testDb.prisma.cachedMarketPrice.create({
      data: { assetId: etf.id, currency: "USD", price: "600", timestamp: new Date(), fetchedAt: new Date(), source: "MANUAL" },
    });

    await linkAssetQuoteMutation({
      assetId: etf.id,
      currency: "EUR",
      quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
      quoteSymbol: "SXR8.DEX",
      quoteMicCode: "XETR",
    }, testDb.prisma);

    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { id: etf.id } })).resolves.toMatchObject({
      currency: "EUR",
      quoteSymbol: "SXR8.DEX",
      quoteMicCode: "XETR",
    });
    expect(await testDb.prisma.cachedMarketPrice.count({ where: { assetId: etf.id } })).toBe(0);
  });

  it("remaps an ETF to an Alpha Vantage listing without MIC and clears its cached quote", async () => {
    const etf = await testDb.prisma.asset.create({
      data: { symbol: "NOMIC", name: "No MIC UCITS ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" },
    });
    await testDb.prisma.cachedMarketPrice.create({
      data: { assetId: etf.id, currency: "USD", price: "100", timestamp: new Date(), fetchedAt: new Date(), source: "MANUAL" },
    });

    await linkAssetQuoteMutation({
      assetId: etf.id,
      currency: "USD",
      quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
      quoteSymbol: "NOMIC",
      quoteMicCode: null,
    }, testDb.prisma);

    await expect(testDb.prisma.asset.findUniqueOrThrow({ where: { id: etf.id } })).resolves.toMatchObject({
      quoteProvider: AssetQuoteProvider.ALPHA_VANTAGE,
      quoteSymbol: "NOMIC",
      quoteMicCode: null,
    });
    expect(await testDb.prisma.cachedMarketPrice.count({ where: { assetId: etf.id } })).toBe(0);
  });

  it("rejects Twelve Data quote links without MIC metadata", async () => {
    const etf = await testDb.prisma.asset.create({
      data: { symbol: "TDNOMIC", name: "Twelve Data ETF", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "USD" },
    });

    await expect(linkAssetQuoteMutation({
      assetId: etf.id,
      currency: "USD",
      quoteProvider: AssetQuoteProvider.TWELVE_DATA,
      quoteSymbol: "TDNOMIC",
      quoteMicCode: null,
    }, testDb.prisma)).rejects.toThrow("MIC");
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

  it("normalizes buy and sell gross totals to price per unit", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Gross Total Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "2", totalAmount: "1000", fee: "5", currency: "USD", executedAt: new Date("2025-01-01") }, testDb.prisma);
    await createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.5", totalAmount: "400", fee: "2", currency: "USD", executedAt: new Date("2025-02-01") }, testDb.prisma);

    const rows = await testDb.prisma.transaction.findMany({ where: { accountId: account.id }, orderBy: { executedAt: "asc" } });
    expect(rows.map((row) => row.pricePerUnit?.toString())).toEqual(["500", "800"]);
    expect(rows.map((row) => row.fee?.toString())).toEqual(["5", "2"]);
  });

  it("rejects inconsistent unit price and gross total", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Price Consistency Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await expect(createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "2", pricePerUnit: "500", totalAmount: "1000.02", currency: "USD", executedAt: new Date("2025-01-01") }, testDb.prisma)).rejects.toThrow("do not match within one cent");
    expect(await testDb.prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("validates a sale against holdings available on its historical date", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Chronology Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "USD", executedAt: new Date("2025-06-01") }, testDb.prisma);
    await expect(createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.5", totalAmount: "600", currency: "USD", executedAt: new Date("2025-05-01") }, testDb.prisma)).rejects.toThrow("earlier buy first");
  });

  it("rejects deleting a buy required by a later sale", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Delete Chronology Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "USD", executedAt: new Date("2025-01-01") }, testDb.prisma);
    await createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.75", totalAmount: "900", currency: "USD", executedAt: new Date("2025-02-01") }, testDb.prisma);
    const buy = await testDb.prisma.transaction.findFirstOrThrow({ where: { accountId: account.id, type: TransactionType.BUY } });
    await expect(deleteTransactionMutation(buy.id, testDb.prisma)).rejects.toThrow("required by a later sale");
    expect(await testDb.prisma.transaction.count({ where: { id: buy.id } })).toBe(1);
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
    ).rejects.toThrow("Add a starting balance or earlier buy first");
  });

  it("rejects selling more than account quantity even with a legacy override field", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(createTransactionMutation(
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
      } as never,
      testDb.prisma,
    )).rejects.toThrow("Add a starting balance or earlier buy first");
  });

  it("creates a transfer as paired rows and moves holdings between accounts", async () => {
    const from = await testDb.prisma.account.create({ data: { name: "Transfer Source", type: AccountType.EXCHANGE } });
    const to = await testDb.prisma.account.create({ data: { name: "Transfer Target", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: from.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "EUR", executedAt: new Date("2026-03-01") }, testDb.prisma);

    await createTransferMutation({
      assetId: btc.id,
      fromAccountId: from.id,
      toAccountId: to.id,
      quantity: "0.4",
      currency: "EUR",
      executedAt: new Date("2026-03-02"),
    }, testDb.prisma);

    const rows = await testDb.prisma.transaction.findMany({ where: { assetId: btc.id, accountId: { in: [from.id, to.id] } }, orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] });
    expect(rows.filter((row) => row.type === TransactionType.TRANSFER_OUT)).toHaveLength(1);
    expect(rows.filter((row) => row.type === TransactionType.TRANSFER_IN)).toHaveLength(1);
    expect(calculateHoldings(rows).sort((left, right) => left.accountId.localeCompare(right.accountId))).toEqual([
      { accountId: from.id, assetId: btc.id, quantity: "0.6" },
      { accountId: to.id, assetId: btc.id, quantity: "0.4" },
    ].sort((left, right) => left.accountId.localeCompare(right.accountId)));
  });

  it("rejects invalid transfers", async () => {
    const from = await testDb.prisma.account.create({ data: { name: "Invalid Transfer Source", type: AccountType.EXCHANGE } });
    const to = await testDb.prisma.account.create({ data: { name: "Invalid Transfer Target", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(createTransferMutation({ assetId: btc.id, fromAccountId: from.id, toAccountId: from.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-04-01") }, testDb.prisma)).rejects.toThrow("must be different");
    await expect(createTransferMutation({ assetId: btc.id, fromAccountId: from.id, toAccountId: to.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-04-01") }, testDb.prisma)).rejects.toThrow("earlier buy first");
  });

  it("creates CASH deposits and withdrawals and rejects unsupported cashflows", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Cashflow Account", type: AccountType.BANK } });
    const eur = await testDb.prisma.asset.create({ data: { symbol: "EUR_CASH_TEST", name: "Euro Cash Test", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await createTransactionMutation({ type: TransactionType.DEPOSIT, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "1000", currency: "EUR", executedAt: new Date("2026-05-01") }, testDb.prisma);
    await createTransactionMutation({ type: TransactionType.WITHDRAWAL, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "250", currency: "EUR", executedAt: new Date("2026-05-02") }, testDb.prisma);

    const rows = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: eur.id } });
    expect(calculateHoldings(rows)).toEqual([{ accountId: account.id, assetId: eur.id, quantity: "750" }]);
    expect(rows.map((row) => row.pricePerUnit?.toString()).sort()).toEqual(["1", "1"]);
    await expect(createTransactionMutation({ type: TransactionType.DEPOSIT, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-05-03") }, testDb.prisma)).rejects.toThrow("only available for CASH");
    await expect(createTransactionMutation({ type: TransactionType.WITHDRAWAL, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "1000", currency: "EUR", executedAt: new Date("2026-05-04") }, testDb.prisma)).rejects.toThrow("earlier buy first");
  });

  it("normalizes physical gold troy ounces and total purchase cost to gram-based storage", async () => {
    const storage = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Physical Storage" } });
    const gold = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "PHYSICAL_GOLD" } });

    await createTransactionMutation(
      createPhysicalGoldInitialBalanceInput({
        accountId: storage.id,
        physicalGoldAssetId: gold.id,
        weightTroyOunces: "1",
        totalPurchaseCost: "3110.34768",
        executedAt: new Date("2026-01-05"),
      }),
      testDb.prisma,
    );

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: storage.id, assetId: gold.id },
    });
    expect(transaction.quantity.toString()).toBe("31.1034768");
    expect(transaction.pricePerUnit?.toString()).toBe("100");
  });

  it("normalizes a physical gold price per troy ounce before saving a buy", async () => {
    const storage = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Physical Storage" } });
    const gold = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "PHYSICAL_GOLD" } });

    await createTransactionMutation({
      type: TransactionType.BUY,
      accountId: storage.id,
      assetMode: "existing",
      assetId: gold.id,
      physicalGoldWeightTroyOunces: "0.5",
      pricePerUnit: "3200",
      currency: "USD",
      executedAt: new Date("2026-02-05"),
    }, testDb.prisma);

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: storage.id, assetId: gold.id, executedAt: new Date("2026-02-05") },
    });
    expect(transaction.quantity.toString()).toBe("15.5517384");
    expect(transaction.pricePerUnit?.mul(transaction.quantity).toDecimalPlaces(2).toString()).toBe("1600");
  });

  it("deletes transactions and lets holdings recalculate", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Deletion Test", type: AccountType.OTHER } });
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

  it("updates acquisition data while keeping transaction identity fixed", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Editable Wallet", type: AccountType.WALLET } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: "EDITABLE", name: "Editable Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    const original = await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, quantity: "1", pricePerUnit: null, currency: "EUR", executedAt: new Date("2026-01-01") },
    });

    await updateTransactionMutation({
      id: original.id,
      quantity: "1.5",
      totalAmount: "300",
      fee: "2",
      executedAt: new Date("2026-01-02"),
      note: "Cost basis restored",
    }, testDb.prisma);

    const updated = await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: original.id } });
    expect(updated).toEqual(expect.objectContaining({
      id: original.id,
      accountId: account.id,
      assetId: asset.id,
      type: TransactionType.INITIAL_BALANCE,
      currency: "EUR",
      note: "Cost basis restored",
    }));
    expect(updated.quantity.toString()).toBe("1.5");
    expect(updated.pricePerUnit?.toString()).toBe("200");
    expect(updated.fee?.toString()).toBe("2");
  });

  it("rolls back an edit that would invalidate later holdings", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Edit Chronology", type: AccountType.WALLET } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: "EDIT_HISTORY", name: "Edit History", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    const buy = await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.BUY, quantity: "1", pricePerUnit: "100", currency: "EUR", executedAt: new Date("2026-01-01") },
    });
    await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.SELL, quantity: "1", pricePerUnit: "120", currency: "EUR", executedAt: new Date("2026-01-02") },
    });

    await expect(updateTransactionMutation({
      id: buy.id,
      quantity: "0.5",
      pricePerUnit: "100",
      executedAt: new Date("2026-01-01"),
    }, testDb.prisma)).rejects.toThrow("required by a later sale");

    expect((await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: buy.id } })).quantity.toString()).toBe("1");
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
