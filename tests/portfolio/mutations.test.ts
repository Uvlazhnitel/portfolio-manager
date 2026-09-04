import { AccountType, AssetClass, AssetQuoteProvider, AssetType, BasisMethod, PortfolioRuleType, TransactionGroupKind, TransactionStatus, TransactionType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateHoldings } from "@/features/portfolio-engine";
import { getTransactionAuditReadModel, getTransactionGroupAuditReadModel } from "@/features/portfolio/audit-read-model";
import {
  createAccountMutation,
  createPhysicalGoldInitialBalanceInput,
  createTradeMutation,
  createTransferMutation,
  createTransactionMutation,
  deleteTransactionGroupMutation,
  deleteTransactionMutation,
  linkAssetQuoteMutation,
  updateTradeMutation,
  updateTransferMutation,
  updateTransactionMutation,
} from "@/features/portfolio/mutations";
import { PortfolioRepository } from "@/features/portfolio/repository";
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
    const result = await createAccountMutation({ name: "Future Broker", type: AccountType.BROKER }, new PortfolioRepository(testDb.prisma));
    const account = await testDb.prisma.account.findUnique({ where: { name: "Future Broker" } });

    expect(result.ok).toBe(true);
    expect(account?.type).toBe(AccountType.BROKER);
  });

  it("creates initial balance transactions", async () => {
    const { account, btc } = await seedBasics();

    await createTransactionMutation(
      {
        type: TransactionType.INITIAL_BALANCE,
        basisMethod: BasisMethod.KNOWN_COST,
        accountId: account.id,
        assetMode: "existing",
        assetId: btc.id,
        quantity: "1.25",
        pricePerUnit: "10000",
        currency: "EUR",
        executedAt: new Date("2026-01-01"),
      },
      new PortfolioRepository(testDb.prisma),
    );

    const transactions = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: btc.id } });
    expect(calculateHoldings(transactions)).toEqual([{ accountId: account.id, assetId: btc.id, quantity: "1.25" }]);
  });

  it("normalizes total invested to an average acquisition price", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.KNOWN_COST,
      accountId: account.id,
      assetMode: "existing",
      assetId: btc.id,
      quantity: "0.25",
      totalPurchaseCost: "12000",
      currency: "EUR",
      executedAt: new Date("2026-01-01T12:00:00Z"),
    }, new PortfolioRepository(testDb.prisma));

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: account.id, assetId: btc.id, quantity: "0.25" },
    });
    expect(transaction.pricePerUnit?.toString()).toBe("48000");
  });

  it("creates zero-cost and fair-value gifts with explicit basis methods", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({
      type: TransactionType.GIFT,
      basisMethod: BasisMethod.ZERO_COST,
      accountId: account.id,
      assetMode: "existing",
      assetId: btc.id,
      quantity: "0.5",
      currency: "EUR",
      executedAt: new Date("2026-02-01"),
    }, new PortfolioRepository(testDb.prisma));
    await createTransactionMutation({
      type: TransactionType.GIFT,
      basisMethod: BasisMethod.FAIR_VALUE,
      accountId: account.id,
      assetMode: "existing",
      assetId: btc.id,
      quantity: "2",
      totalAmount: "300",
      currency: "EUR",
      executedAt: new Date("2026-02-02"),
    }, new PortfolioRepository(testDb.prisma));

    const gifts = await testDb.prisma.transaction.findMany({ where: { type: TransactionType.GIFT }, orderBy: { executedAt: "asc" } });
    expect(gifts[0]).toEqual(expect.objectContaining({ basisMethod: BasisMethod.ZERO_COST }));
    expect(gifts[0].pricePerUnit?.toString()).toBe("0");
    expect(gifts[1]).toEqual(expect.objectContaining({ basisMethod: BasisMethod.FAIR_VALUE }));
    expect(gifts[1].pricePerUnit?.toString()).toBe("150");
  });

  it("corrects a gift by replacing the financial row and preserving audit history", async () => {
    const gift = await testDb.prisma.transaction.findFirstOrThrow({ where: { type: TransactionType.GIFT, basisMethod: BasisMethod.ZERO_COST } });
    await updateTransactionMutation({
      id: gift.id,
      basisMethod: BasisMethod.FAIR_VALUE,
      quantity: gift.quantity.toString(),
      totalAmount: "250",
      executedAt: gift.executedAt,
      note: "Basis documented",
      auditReason: "Statement confirmed fair value",
    }, new PortfolioRepository(testDb.prisma));

    const old = await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: gift.id } });
    const replacement = await testDb.prisma.transaction.findFirstOrThrow({ where: { replacesTransactionId: gift.id } });
    expect(old.status).toBe(TransactionStatus.REPLACED);
    expect(old.statusReason).toBe("Statement confirmed fair value");
    expect(replacement.id).not.toBe(gift.id);
    expect(replacement).toEqual(expect.objectContaining({ basisMethod: BasisMethod.FAIR_VALUE, note: "Basis documented", status: TransactionStatus.ACTIVE }));
    expect(replacement.pricePerUnit?.toString()).toBe("500");

    const audit = await getTransactionAuditReadModel(gift.id, new PortfolioRepository(testDb.prisma));
    expect(audit?.events.map((event) => event.action)).toEqual(expect.arrayContaining(["CREATED", "REPLACED", "CORRECTED"]));
  });

  it("rejects missing or malformed opening and gift basis choices", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    const common = { accountId: account.id, assetMode: "existing" as const, assetId: btc.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-03-01") };
    await expect(createTransactionMutation({ ...common, type: TransactionType.INITIAL_BALANCE, pricePerUnit: "10" }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("Choose whether");
    await expect(createTransactionMutation({ ...common, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.UNKNOWN, pricePerUnit: "10" }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("cannot include");
    await expect(createTransactionMutation({ ...common, type: TransactionType.GIFT, basisMethod: BasisMethod.FAIR_VALUE }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("fair value");
  });

  it("enforces basis shapes at the database boundary", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await expect(testDb.prisma.transaction.create({ data: {
      accountId: account.id,
      assetId: btc.id,
      type: TransactionType.GIFT,
      basisMethod: BasisMethod.ZERO_COST,
      quantity: "1",
      pricePerUnit: "5",
      currency: "EUR",
      executedAt: new Date("2026-03-02"),
    } })).rejects.toThrow();
    await expect(testDb.prisma.transaction.create({ data: {
      accountId: account.id,
      assetId: btc.id,
      type: TransactionType.INITIAL_BALANCE,
      quantity: "1",
      pricePerUnit: "5",
      currency: "EUR",
      executedAt: new Date("2026-03-03"),
    } })).rejects.toThrow();
  });

  it("reuses an existing asset with the same external catalog id", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });
    const existing = await testDb.prisma.asset.create({
      data: { symbol: "SOL", name: "Solana", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "SOL", externalId: "solana" },
    });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.UNKNOWN,
      accountId: account.id,
      assetMode: "new",
      newAsset: { symbol: "SOLANA", name: "Untrusted duplicate name", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "SOL", externalId: "solana" },
      quantity: "5",
      currency: "EUR",
      executedAt: new Date("2026-01-01T12:00:00Z"),
    }, new PortfolioRepository(testDb.prisma));

    expect(await testDb.prisma.asset.count({ where: { externalId: "solana" } })).toBe(1);
    expect(await testDb.prisma.transaction.count({ where: { assetId: existing.id, quantity: "5" } })).toBe(1);
  });

  it("persists a selected Alpha Vantage listing when creating an ETF", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "ETF Broker", type: AccountType.BROKER } });

    await createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.KNOWN_COST,
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
    }, new PortfolioRepository(testDb.prisma));

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
      basisMethod: BasisMethod.KNOWN_COST,
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
    }, new PortfolioRepository(testDb.prisma));

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
    }, new PortfolioRepository(testDb.prisma));

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
    }, new PortfolioRepository(testDb.prisma));

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
    }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("MIC");
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
      new PortfolioRepository(testDb.prisma),
    );

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({ where: { type: TransactionType.BUY } });
    expect(transaction.pricePerUnit?.toString()).toBe("12000");
    expect(transaction.fee?.toString()).toBe("3");
  });

  it("normalizes buy and sell gross totals to price per unit", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Gross Total Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "2", totalAmount: "1000", fee: "5", currency: "USD", executedAt: new Date("2025-01-01") }, new PortfolioRepository(testDb.prisma));
    await createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.5", totalAmount: "400", fee: "2", currency: "USD", executedAt: new Date("2025-02-01") }, new PortfolioRepository(testDb.prisma));

    const rows = await testDb.prisma.transaction.findMany({ where: { accountId: account.id }, orderBy: { executedAt: "asc" } });
    expect(rows.map((row) => row.pricePerUnit?.toString())).toEqual(["500", "800"]);
    expect(rows.map((row) => row.fee?.toString())).toEqual(["5", "2"]);
  });

  it("rejects inconsistent unit price and gross total", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Price Consistency Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await expect(createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "2", pricePerUnit: "500", totalAmount: "1000.02", currency: "USD", executedAt: new Date("2025-01-01") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("do not match within one cent");
    expect(await testDb.prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("validates a sale against holdings available on its historical date", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Chronology Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "USD", executedAt: new Date("2025-06-01") }, new PortfolioRepository(testDb.prisma));
    await expect(createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.5", totalAmount: "600", currency: "USD", executedAt: new Date("2025-05-01") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("earlier buy first");
  });

  it("rejects deleting a buy required by a later sale", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Delete Chronology Test", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "USD", executedAt: new Date("2025-01-01") }, new PortfolioRepository(testDb.prisma));
    await createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.75", totalAmount: "900", currency: "USD", executedAt: new Date("2025-02-01") }, new PortfolioRepository(testDb.prisma));
    const buy = await testDb.prisma.transaction.findFirstOrThrow({ where: { accountId: account.id, type: TransactionType.BUY } });
    await expect(deleteTransactionMutation(buy.id, new PortfolioRepository(testDb.prisma))).rejects.toThrow("required by a later sale");
    expect(await testDb.prisma.transaction.count({ where: { id: buy.id, status: TransactionStatus.ACTIVE } })).toBe(1);
  });

  it("voided SELL no longer decreases active holdings", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Voided Sell Wallet", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "2", pricePerUnit: "100", currency: "EUR", executedAt: new Date("2026-02-01") }, new PortfolioRepository(testDb.prisma));
    await createTransactionMutation({ type: TransactionType.SELL, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.75", pricePerUnit: "120", currency: "EUR", executedAt: new Date("2026-02-02") }, new PortfolioRepository(testDb.prisma));
    const sell = await testDb.prisma.transaction.findFirstOrThrow({ where: { accountId: account.id, assetId: btc.id, type: TransactionType.SELL } });

    await deleteTransactionMutation(sell.id, new PortfolioRepository(testDb.prisma));

    const rows = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: btc.id } });
    expect(rows.find((row) => row.id === sell.id)?.status).toBe(TransactionStatus.VOIDED);
    expect(calculateHoldings(rows)).toEqual([{ accountId: account.id, assetId: btc.id, quantity: "2" }]);
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
        new PortfolioRepository(testDb.prisma),
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
      new PortfolioRepository(testDb.prisma),
    )).rejects.toThrow("Add a starting balance or earlier buy first");
  });

  it("creates a transfer as paired rows and moves holdings between accounts", async () => {
    const from = await testDb.prisma.account.create({ data: { name: "Transfer Source", type: AccountType.EXCHANGE } });
    const to = await testDb.prisma.account.create({ data: { name: "Transfer Target", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: from.id, assetMode: "existing", assetId: btc.id, quantity: "1", totalAmount: "1000", currency: "EUR", executedAt: new Date("2026-03-01") }, new PortfolioRepository(testDb.prisma));

    await createTransferMutation({
      assetId: btc.id,
      fromAccountId: from.id,
      toAccountId: to.id,
      quantity: "0.4",
      currency: "EUR",
      executedAt: new Date("2026-03-02"),
    }, new PortfolioRepository(testDb.prisma));

    const rows = await testDb.prisma.transaction.findMany({ where: { assetId: btc.id, accountId: { in: [from.id, to.id] } }, orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] });
    expect(rows.filter((row) => row.type === TransactionType.TRANSFER_OUT)).toHaveLength(1);
    expect(rows.filter((row) => row.type === TransactionType.TRANSFER_IN)).toHaveLength(1);
    const transferLegs = rows.filter((row) => row.type === TransactionType.TRANSFER_IN || row.type === TransactionType.TRANSFER_OUT);
    expect(transferLegs[0].transactionGroupId).toBeTruthy();
    expect(transferLegs[1].transactionGroupId).toBe(transferLegs[0].transactionGroupId);
    await expect(testDb.prisma.transactionGroup.findUniqueOrThrow({ where: { id: transferLegs[0].transactionGroupId! } })).resolves.toMatchObject({ kind: TransactionGroupKind.TRANSFER });
    expect(calculateHoldings(rows).sort((left, right) => left.accountId.localeCompare(right.accountId))).toEqual([
      { accountId: from.id, assetId: btc.id, quantity: "0.6" },
      { accountId: to.id, assetId: btc.id, quantity: "0.4" },
    ].sort((left, right) => left.accountId.localeCompare(right.accountId)));
  });

  it("creates a linked trade with execution prices and no external cashflow", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Trade Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Trade Destination", type: AccountType.WALLET } });
    const usdt = await testDb.prisma.asset.create({ data: { symbol: "USDT_TRADE", name: "Trade USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USD" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: source.id, assetMode: "existing", assetId: usdt.id, quantity: "1000", pricePerUnit: "1", currency: "USD", executedAt: new Date("2026-06-01") }, new PortfolioRepository(testDb.prisma));

    await createTradeMutation({ sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "500", sourcePricePerUnit: "1", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.0045", fee: "2", currency: "USD", executedAt: new Date("2026-06-02"), note: "USDT to BTC" }, new PortfolioRepository(testDb.prisma));

    const legs = await testDb.prisma.transaction.findMany({ where: { transactionGroup: { kind: TransactionGroupKind.TRADE }, accountId: { in: [source.id, destination.id] } }, orderBy: { type: "asc" } });
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.transactionGroupId)).size).toBe(1);
    const sell = legs.find((leg) => leg.type === TransactionType.SELL)!;
    const buy = legs.find((leg) => leg.type === TransactionType.BUY)!;
    expect(sell.pricePerUnit?.toString()).toBe("1");
    expect(buy.pricePerUnit?.mul(buy.quantity).toDecimalPlaces(2).toString()).toBe("498");
    expect(buy.fee?.toString()).toBe("2");
    expect(calculateHoldings(await testDb.prisma.transaction.findMany({ where: { accountId: { in: [source.id, destination.id] }, assetId: { in: [usdt.id, btc.id] } } }))).toEqual(expect.arrayContaining([
      { accountId: source.id, assetId: usdt.id, quantity: "500" },
      { accountId: destination.id, assetId: btc.id, quantity: "0.0045" },
    ]));

    await updateTradeMutation({ groupId: sell.transactionGroupId!, sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "400", sourceTotalAmount: "400", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.005", fee: "1", currency: "USD", executedAt: new Date("2026-06-02"), note: "edited trade", auditReason: "Correct exchange fill" }, new PortfolioRepository(testDb.prisma));
    const oldLegs = await testDb.prisma.transaction.findMany({ where: { transactionGroupId: sell.transactionGroupId } });
    expect(oldLegs.every((leg) => leg.status === TransactionStatus.REPLACED && leg.statusReason === "Correct exchange fill")).toBe(true);
    const replacements = await testDb.prisma.transaction.findMany({ where: { replacesTransactionId: { in: oldLegs.map((leg) => leg.id) } }, orderBy: { type: "asc" } });
    expect(new Set(replacements.map((leg) => leg.transactionGroupId)).size).toBe(1);
    const replacementSell = replacements.find((leg) => leg.type === TransactionType.SELL)!;
    const replacementBuy = replacements.find((leg) => leg.type === TransactionType.BUY)!;
    expect(replacementSell.quantity.toString()).toBe("400");
    expect(replacementSell.pricePerUnit?.toString()).toBe("1");
    expect(replacementBuy.quantity.toString()).toBe("0.005");
    expect(replacementBuy.pricePerUnit?.mul(replacementBuy.quantity).toDecimalPlaces(2).toString()).toBe("399");
    expect(replacements.every((leg) => leg.note === "edited trade" && leg.status === TransactionStatus.ACTIVE)).toBe(true);

    await deleteTransactionGroupMutation(replacements[0].transactionGroupId!, new PortfolioRepository(testDb.prisma));
    const voidedTradeLegs = await testDb.prisma.transaction.findMany({ where: { transactionGroupId: replacements[0].transactionGroupId } });
    expect(voidedTradeLegs.every((leg) => leg.status === TransactionStatus.VOIDED)).toBe(true);
  });

  it("records the source sale at execution price instead of acquisition basis", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "BTC Trade Execution Source", type: AccountType.EXCHANGE } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    const usdt = await testDb.prisma.asset.create({ data: { symbol: "USDT_BTC_EXECUTION", name: "BTC Execution USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USD" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "0.02", pricePerUnit: "40000", currency: "USD", executedAt: new Date("2026-06-01") }, new PortfolioRepository(testDb.prisma));

    await createTradeMutation({ sourceAccountId: account.id, sourceAssetId: btc.id, sourceQuantity: "0.01", sourcePricePerUnit: "60000", destinationAccountId: account.id, destinationAssetId: usdt.id, destinationQuantity: "598", fee: "2", currency: "USD", executedAt: new Date("2026-06-02"), note: "BTC to USDT execution" }, new PortfolioRepository(testDb.prisma));

    const legs = await testDb.prisma.transaction.findMany({
      where: { transactionGroup: { kind: TransactionGroupKind.TRADE }, note: "BTC to USDT execution" },
      orderBy: { type: "asc" },
    });
    const sell = legs.find((leg) => leg.type === TransactionType.SELL)!;
    const buy = legs.find((leg) => leg.type === TransactionType.BUY)!;
    expect(sell.pricePerUnit?.toString()).toBe("60000");
    expect(buy.pricePerUnit?.toString()).toBe("1");
    expect(buy.fee?.toString()).toBe("2");
  });

  it("creates a trade with execution prices when source cost basis is unknown", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Unknown Basis Trade Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Unknown Basis Trade Destination", type: AccountType.WALLET } });
    const usdt = await testDb.prisma.asset.create({ data: { symbol: "USDT_UNKNOWN_BASIS", name: "Unknown Basis USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USDT" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.UNKNOWN, accountId: source.id, assetMode: "existing", assetId: usdt.id, quantity: "1000", currency: "USD", executedAt: new Date("2026-09-01") }, new PortfolioRepository(testDb.prisma));

    await createTradeMutation({ sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "250", sourcePricePerUnit: "1", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.0025", currency: "USD", executedAt: new Date("2026-09-02"), note: "Unknown basis trade" }, new PortfolioRepository(testDb.prisma));

    const legs = await testDb.prisma.transaction.findMany({
      where: { transactionGroup: { kind: TransactionGroupKind.TRADE }, note: "Unknown basis trade" },
      orderBy: { type: "asc" },
    });
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((leg) => leg.transactionGroupId)).size).toBe(1);
    expect(legs.every((leg) => leg.status === TransactionStatus.ACTIVE && leg.pricePerUnit !== null)).toBe(true);
    expect(legs.find((leg) => leg.type === TransactionType.SELL)?.pricePerUnit?.toString()).toBe("1");
    expect(legs.find((leg) => leg.type === TransactionType.BUY)?.pricePerUnit?.mul(legs.find((leg) => leg.type === TransactionType.BUY)!.quantity).toDecimalPlaces(2).toString()).toBe("250");
    expect(calculateHoldings(await testDb.prisma.transaction.findMany({ where: { accountId: { in: [source.id, destination.id] }, assetId: { in: [usdt.id, btc.id] } } }))).toEqual(expect.arrayContaining([
      { accountId: source.id, assetId: usdt.id, quantity: "750" },
      { accountId: destination.id, assetId: btc.id, quantity: "0.0025" },
    ]));
  });

  it("validates trade execution price/proceeds and fee", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Trade Execution Validation Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Trade Execution Validation Destination", type: AccountType.WALLET } });
    const usdt = await testDb.prisma.asset.create({ data: { symbol: "USDT_TRADE_VALIDATION", name: "Trade Validation USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USD" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: source.id, assetMode: "existing", assetId: usdt.id, quantity: "1000", pricePerUnit: "1", currency: "USD", executedAt: new Date("2026-06-01") }, new PortfolioRepository(testDb.prisma));

    await expect(createTradeMutation({ sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "100", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.001", currency: "USD", executedAt: new Date("2026-06-02") }, new PortfolioRepository(testDb.prisma)))
      .rejects.toThrow("source execution price or gross source proceeds");
    await expect(createTradeMutation({ sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "100", sourcePricePerUnit: "1", sourceTotalAmount: "101.02", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.001", currency: "USD", executedAt: new Date("2026-06-02") }, new PortfolioRepository(testDb.prisma)))
      .rejects.toThrow("do not match within one cent");
    await expect(createTradeMutation({ sourceAccountId: source.id, sourceAssetId: usdt.id, sourceQuantity: "100", sourceTotalAmount: "100", destinationAccountId: destination.id, destinationAssetId: btc.id, destinationQuantity: "0.001", fee: "100", currency: "USD", executedAt: new Date("2026-06-02") }, new PortfolioRepository(testDb.prisma)))
      .rejects.toThrow("fee must be less than gross source proceeds");
  });

  it("allows all-known and all-null trade prices at the database boundary but rejects mixed trade prices", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Nullable Trade DB Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Nullable Trade DB Destination", type: AccountType.WALLET } });
    const usdt = await testDb.prisma.asset.create({ data: { symbol: "USDT_DB_NULL_TRADE", name: "DB Null Trade USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USDT" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(testDb.prisma.$transaction(async (db) => {
      const group = await db.transactionGroup.create({ data: { kind: TransactionGroupKind.TRADE } });
      await db.transaction.createMany({ data: [
        { transactionGroupId: group.id, accountId: source.id, assetId: usdt.id, type: TransactionType.SELL, quantity: "100", pricePerUnit: null, currency: "USD", executedAt: new Date("2026-09-03") },
        { transactionGroupId: group.id, accountId: destination.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0.001", pricePerUnit: null, currency: "USD", executedAt: new Date("2026-09-03") },
      ] });
    })).resolves.toBeUndefined();

    await expect(testDb.prisma.$transaction(async (db) => {
      const group = await db.transactionGroup.create({ data: { kind: TransactionGroupKind.TRADE } });
      await db.transaction.createMany({ data: [
        { transactionGroupId: group.id, accountId: source.id, assetId: usdt.id, type: TransactionType.SELL, quantity: "100", pricePerUnit: "1", currency: "USD", executedAt: new Date("2026-09-04") },
        { transactionGroupId: group.id, accountId: destination.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0.001", pricePerUnit: "100000", currency: "USD", executedAt: new Date("2026-09-04") },
      ] });
    })).resolves.toBeUndefined();

    await expect(testDb.prisma.$transaction(async (db) => {
      const group = await db.transactionGroup.create({ data: { kind: TransactionGroupKind.TRADE } });
      await db.transaction.createMany({ data: [
        { transactionGroupId: group.id, accountId: source.id, assetId: usdt.id, type: TransactionType.SELL, quantity: "100", pricePerUnit: null, currency: "USD", executedAt: new Date("2026-09-05") },
        { transactionGroupId: group.id, accountId: destination.id, assetId: btc.id, type: TransactionType.BUY, quantity: "0.001", pricePerUnit: "100000", currency: "USD", executedAt: new Date("2026-09-05") },
      ] });
    })).rejects.toThrow("invalid TRADE legs");
  });

  it("rolls back an insufficient trade without saving a group or either leg", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Empty Trade Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Empty Trade Destination", type: AccountType.WALLET } });
    const [btc, gold] = await Promise.all([
      testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } }),
      testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "PHYSICAL_GOLD" } }),
    ]);
    const groupsBefore = await testDb.prisma.transactionGroup.count();
    await expect(createTradeMutation({ sourceAccountId: source.id, sourceAssetId: btc.id, sourceQuantity: "1", destinationAccountId: destination.id, destinationAssetId: gold.id, destinationQuantity: "1", currency: "USD", executedAt: new Date("2026-06-03") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("earlier buy first");
    expect(await testDb.prisma.transactionGroup.count()).toBe(groupsBefore);
    expect(await testDb.prisma.transaction.count({ where: { accountId: { in: [source.id, destination.id] } } })).toBe(0);
  });

  it("edits both transfer legs atomically and rolls back a chronology-breaking edit", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Atomic Transfer Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Atomic Transfer Destination", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: source.id, assetMode: "existing", assetId: btc.id, quantity: "1", pricePerUnit: "100", currency: "USD", executedAt: new Date("2026-07-01") }, new PortfolioRepository(testDb.prisma));
    await createTransferMutation({ assetId: btc.id, fromAccountId: source.id, toAccountId: destination.id, quantity: "0.4", currency: "USD", executedAt: new Date("2026-07-02") }, new PortfolioRepository(testDb.prisma));
    const group = await testDb.prisma.transactionGroup.findFirstOrThrow({ where: { kind: TransactionGroupKind.TRANSFER, transactions: { some: { accountId: source.id } } } });
    await updateTransferMutation({ groupId: group.id, assetId: btc.id, fromAccountId: source.id, toAccountId: destination.id, quantity: "0.5", currency: "USD", executedAt: new Date("2026-07-02"), note: "edited" }, new PortfolioRepository(testDb.prisma));
    const oldLegs = await testDb.prisma.transaction.findMany({ where: { transactionGroupId: group.id } });
    expect(oldLegs.every((leg) => leg.status === TransactionStatus.REPLACED)).toBe(true);
    const activeReplacementLegs = await testDb.prisma.transaction.findMany({
      where: { replacesTransactionId: { in: oldLegs.map((leg) => leg.id) } },
      orderBy: { type: "asc" },
    });
    const activeGroupId = activeReplacementLegs[0].transactionGroupId!;
    expect(new Set(activeReplacementLegs.map((leg) => leg.transactionGroupId)).size).toBe(1);
    expect(activeReplacementLegs.map((leg) => leg.quantity.toString())).toEqual(["0.5", "0.5"]);
    await createTransactionMutation({ type: TransactionType.SELL, accountId: destination.id, assetMode: "existing", assetId: btc.id, quantity: "0.5", pricePerUnit: "120", currency: "USD", executedAt: new Date("2026-07-03") }, new PortfolioRepository(testDb.prisma));
    await expect(updateTransferMutation({ groupId: activeGroupId, assetId: btc.id, fromAccountId: source.id, toAccountId: destination.id, quantity: "0.25", currency: "USD", executedAt: new Date("2026-07-02") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("required by a later sale");
    expect((await testDb.prisma.transaction.findMany({ where: { transactionGroupId: activeGroupId }, orderBy: { type: "asc" } })).map((leg) => leg.quantity.toString())).toEqual(["0.5", "0.5"]);
    expect(await testDb.prisma.transaction.count({ where: { transactionGroupId: activeGroupId, status: TransactionStatus.ACTIVE } })).toBe(2);
  });

  it("voids a complete group atomically and rejects one-legged groups at commit", async () => {
    const source = await testDb.prisma.account.create({ data: { name: "Delete Group Source", type: AccountType.EXCHANGE } });
    const destination = await testDb.prisma.account.create({ data: { name: "Delete Group Destination", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    await createTransactionMutation({ type: TransactionType.BUY, accountId: source.id, assetMode: "existing", assetId: btc.id, quantity: "1", pricePerUnit: "100", currency: "USD", executedAt: new Date("2026-08-01") }, new PortfolioRepository(testDb.prisma));
    await createTransferMutation({ assetId: btc.id, fromAccountId: source.id, toAccountId: destination.id, quantity: "0.2", currency: "USD", executedAt: new Date("2026-08-02") }, new PortfolioRepository(testDb.prisma));
    const group = await testDb.prisma.transactionGroup.findFirstOrThrow({ where: { kind: TransactionGroupKind.TRANSFER, transactions: { some: { accountId: source.id } } } });
    await deleteTransactionGroupMutation({ groupId: group.id, auditReason: "Duplicate transfer" }, new PortfolioRepository(testDb.prisma));
    const voidedLegs = await testDb.prisma.transaction.findMany({ where: { transactionGroupId: group.id } });
    expect(voidedLegs).toHaveLength(2);
    expect(voidedLegs.every((leg) => leg.status === TransactionStatus.VOIDED && leg.statusReason === "Duplicate transfer")).toBe(true);
    expect(await testDb.prisma.transactionGroup.findUnique({ where: { id: group.id } })).not.toBeNull();
    const audit = await getTransactionGroupAuditReadModel(group.id, new PortfolioRepository(testDb.prisma));
    expect(audit?.events.filter((event) => event.action === "VOIDED")).toHaveLength(2);

    await createTransferMutation({ assetId: btc.id, fromAccountId: source.id, toAccountId: destination.id, quantity: "0.3", currency: "USD", executedAt: new Date("2026-08-04") }, new PortfolioRepository(testDb.prisma));
    const requiredGroup = await testDb.prisma.transactionGroup.findFirstOrThrow({ where: { kind: TransactionGroupKind.TRANSFER, transactions: { some: { accountId: source.id, executedAt: new Date("2026-08-04") } } } });
    await createTransactionMutation({ type: TransactionType.SELL, accountId: destination.id, assetMode: "existing", assetId: btc.id, quantity: "0.3", pricePerUnit: "120", currency: "USD", executedAt: new Date("2026-08-05") }, new PortfolioRepository(testDb.prisma));
    await expect(deleteTransactionGroupMutation(requiredGroup.id, new PortfolioRepository(testDb.prisma))).rejects.toThrow("required by a later sale");
    expect(await testDb.prisma.transaction.count({ where: { transactionGroupId: requiredGroup.id } })).toBe(2);
    expect(await testDb.prisma.transaction.count({ where: { transactionGroupId: requiredGroup.id, status: TransactionStatus.ACTIVE } })).toBe(2);

    await expect(testDb.prisma.transaction.create({ data: { accountId: source.id, assetId: btc.id, type: TransactionType.TRANSFER_OUT, quantity: "0.1", currency: "USD", executedAt: new Date("2026-08-03") } })).rejects.toThrow("must belong to a transaction group");

    await expect(testDb.prisma.$transaction(async (db) => {
      const invalid = await db.transactionGroup.create({ data: { kind: TransactionGroupKind.TRANSFER } });
      await db.transaction.create({ data: { transactionGroupId: invalid.id, accountId: source.id, assetId: btc.id, type: TransactionType.TRANSFER_OUT, quantity: "0.1", currency: "USD", executedAt: new Date("2026-08-03") } });
    })).rejects.toThrow("exactly two legs");
  });

  it("keeps legacy ungrouped standalone transactions working", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Legacy Standalone", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    const row = await testDb.prisma.transaction.create({ data: { accountId: account.id, assetId: btc.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "1", pricePerUnit: "10", currency: "USD", executedAt: new Date("2025-01-01") } });
    expect(row.transactionGroupId).toBeNull();
    await updateTransactionMutation({ id: row.id, quantity: "2", pricePerUnit: "10", executedAt: new Date("2025-01-01") }, new PortfolioRepository(testDb.prisma));
    expect((await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(TransactionStatus.REPLACED);
    const replacement = await testDb.prisma.transaction.findFirstOrThrow({ where: { replacesTransactionId: row.id } });
    expect(replacement.quantity.toString()).toBe("2");
    await expect(deleteTransactionMutation(row.id, new PortfolioRepository(testDb.prisma))).rejects.toThrow("Only active transactions can be voided");
    await deleteTransactionMutation(replacement.id, new PortfolioRepository(testDb.prisma));
    expect((await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe(TransactionStatus.VOIDED);
  });

  it("rejects invalid transfers", async () => {
    const from = await testDb.prisma.account.create({ data: { name: "Invalid Transfer Source", type: AccountType.EXCHANGE } });
    const to = await testDb.prisma.account.create({ data: { name: "Invalid Transfer Target", type: AccountType.WALLET } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await expect(createTransferMutation({ assetId: btc.id, fromAccountId: from.id, toAccountId: from.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-04-01") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("must be different");
    await expect(createTransferMutation({ assetId: btc.id, fromAccountId: from.id, toAccountId: to.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-04-01") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("earlier buy first");
  });

  it("creates CASH deposits and withdrawals and rejects unsupported cashflows", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Cashflow Account", type: AccountType.BANK } });
    const eur = await testDb.prisma.asset.create({ data: { symbol: "EUR_CASH_TEST", name: "Euro Cash Test", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });

    await createTransactionMutation({ type: TransactionType.DEPOSIT, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "1000", currency: "EUR", executedAt: new Date("2026-05-01") }, new PortfolioRepository(testDb.prisma));
    await createTransactionMutation({ type: TransactionType.WITHDRAWAL, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "250", currency: "EUR", executedAt: new Date("2026-05-02") }, new PortfolioRepository(testDb.prisma));

    const rows = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: eur.id } });
    expect(calculateHoldings(rows)).toEqual([{ accountId: account.id, assetId: eur.id, quantity: "750" }]);
    expect(rows.map((row) => row.pricePerUnit?.toString()).sort()).toEqual(["1", "1"]);
    await expect(createTransactionMutation({ type: TransactionType.DEPOSIT, accountId: account.id, assetMode: "existing", assetId: btc.id, quantity: "1", currency: "EUR", executedAt: new Date("2026-05-03") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("only available for CASH");
    await expect(createTransactionMutation({ type: TransactionType.WITHDRAWAL, accountId: account.id, assetMode: "existing", assetId: eur.id, quantity: "1000", currency: "EUR", executedAt: new Date("2026-05-04") }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("earlier buy first");
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
      new PortfolioRepository(testDb.prisma),
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
    }, new PortfolioRepository(testDb.prisma));

    const transaction = await testDb.prisma.transaction.findFirstOrThrow({
      where: { accountId: storage.id, assetId: gold.id, executedAt: new Date("2026-02-05") },
    });
    expect(transaction.quantity.toString()).toBe("15.5517384");
    expect(transaction.pricePerUnit?.mul(transaction.quantity).toDecimalPlaces(2).toString()).toBe("1600");
  });

  it("voids transactions and lets active holdings recalculate", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Deletion Test", type: AccountType.OTHER } });
    const btc = await testDb.prisma.asset.findFirstOrThrow({ where: { symbol: "BTC" } });
    const transaction = await testDb.prisma.transaction.create({
      data: {
        accountId: account.id,
        assetId: btc.id,
        type: TransactionType.INITIAL_BALANCE,
        basisMethod: BasisMethod.UNKNOWN,
        quantity: "2",
        currency: "EUR",
        executedAt: new Date("2026-01-06"),
      },
    });

    await deleteTransactionMutation(transaction.id, new PortfolioRepository(testDb.prisma));

    const transactions = await testDb.prisma.transaction.findMany({ where: { id: transaction.id } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].status).toBe(TransactionStatus.VOIDED);
    expect(calculateHoldings(transactions)).toEqual([]);
  });

  it("creates a new asset and transaction together", async () => {
    const account = await testDb.prisma.account.findFirstOrThrow({ where: { name: "Bybit" } });

    await createTransactionMutation(
      {
        type: TransactionType.INITIAL_BALANCE,
        basisMethod: BasisMethod.KNOWN_COST,
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
      new PortfolioRepository(testDb.prisma),
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
      basisMethod: BasisMethod.KNOWN_COST,
      accountId: account.id,
      assetMode: "new",
      newAsset: { symbol: "btc", name: "Wrong asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
      quantity: "1",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2026-01-08"),
    }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("already exists");

    const after = await testDb.prisma.asset.findUniqueOrThrow({ where: { symbol: "BTC" } });
    expect(after).toEqual(before);
  });

  it("rolls back a new asset when its transaction cannot be created", async () => {
    await expect(createTransactionMutation({
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.KNOWN_COST,
      accountId: "missing-account",
      assetMode: "new",
      newAsset: { symbol: "ROLLBACK", name: "Rollback Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
      quantity: "1",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2026-01-08"),
    }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("Selected account does not exist");

    expect(await testDb.prisma.asset.findUnique({ where: { symbol: "ROLLBACK" } })).toBeNull();
  });

  it("serializes concurrent sells so the account cannot oversell accidentally", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Concurrent Wallet", type: AccountType.WALLET } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: "CONCURRENT", name: "Concurrent Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "1", pricePerUnit: "1", currency: "EUR", executedAt: new Date("2026-01-01") },
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
    }, new PortfolioRepository(testDb.prisma));

    const results = await Promise.allSettled([sell(), sell()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await testDb.prisma.transaction.count({
      where: {
        accountId: account.id,
        assetId: asset.id,
        type: TransactionType.SELL,
        status: TransactionStatus.ACTIVE,
      },
    })).toBe(1);
  });

  it("corrects acquisition data by creating one active replacement", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Editable Wallet", type: AccountType.WALLET } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: "EDITABLE", name: "Editable Asset", assetClass: AssetClass.OTHER, assetType: AssetType.OTHER, currency: "EUR" },
    });
    const original = await testDb.prisma.transaction.create({
      data: { accountId: account.id, assetId: asset.id, type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.UNKNOWN, quantity: "1", pricePerUnit: null, currency: "EUR", executedAt: new Date("2026-01-01") },
    });

    await updateTransactionMutation({
      id: original.id,
      basisMethod: BasisMethod.KNOWN_COST,
      quantity: "1.5",
      totalAmount: "300",
      fee: "2",
      executedAt: new Date("2026-01-02"),
      note: "Cost basis restored",
    }, new PortfolioRepository(testDb.prisma));

    const replaced = await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: original.id } });
    const updated = await testDb.prisma.transaction.findFirstOrThrow({ where: { replacesTransactionId: original.id } });
    expect(replaced.status).toBe(TransactionStatus.REPLACED);
    expect(updated).toEqual(expect.objectContaining({
      accountId: account.id,
      assetId: asset.id,
      type: TransactionType.INITIAL_BALANCE,
      currency: "EUR",
      note: "Cost basis restored",
      status: TransactionStatus.ACTIVE,
    }));
    expect(updated.id).not.toBe(original.id);
    expect(updated.quantity.toString()).toBe("1.5");
    expect(updated.pricePerUnit?.toString()).toBe("200");
    expect(updated.fee?.toString()).toBe("2");
    const activeTransactions = await testDb.prisma.transaction.findMany({ where: { accountId: account.id, assetId: asset.id, status: TransactionStatus.ACTIVE } });
    expect(calculateHoldings(activeTransactions)).toEqual([{ accountId: account.id, assetId: asset.id, quantity: "1.5" }]);
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
    }, new PortfolioRepository(testDb.prisma))).rejects.toThrow("required by a later sale");

    const persisted = await testDb.prisma.transaction.findUniqueOrThrow({ where: { id: buy.id } });
    expect(persisted.quantity.toString()).toBe("1");
    expect(persisted.status).toBe(TransactionStatus.ACTIVE);
    expect(await testDb.prisma.transaction.count({ where: { replacesTransactionId: buy.id } })).toBe(0);
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

    const immutable = await testDb.prisma.transaction.findFirstOrThrow({ where: { accountId: account.id, assetId: btc.id } });
    await expect(testDb.prisma.transaction.update({ where: { id: immutable.id }, data: { quantity: "999" } })).rejects.toThrow();
    await expect(testDb.prisma.transaction.delete({ where: { id: immutable.id } })).rejects.toThrow();

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
