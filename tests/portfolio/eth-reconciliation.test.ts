import { AccountType, AssetClass, AssetType, BasisMethod, TransactionType } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ETH_RECONCILIATION, reconcileEthOpeningBalance } from "@/features/portfolio/eth-reconciliation";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

beforeEach(async () => {
  await testDb.prisma.transaction.deleteMany();
  await testDb.prisma.asset.deleteMany();
  await testDb.prisma.account.deleteMany();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("ETH opening balance reconciliation", () => {
  it("creates one known-cost ETH opening balance and is idempotent", async () => {
    const first = await reconcileEthOpeningBalance(testDb.prisma);
    const second = await reconcileEthOpeningBalance(testDb.prisma);

    const transactions = await testDb.prisma.transaction.findMany({
      include: { account: true, asset: true },
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.transactionId).toBe(first.transactionId);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual(expect.objectContaining({
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.KNOWN_COST,
      currency: ETH_RECONCILIATION.currency,
      note: ETH_RECONCILIATION.note,
    }));
    expect(transactions[0].account.name).toBe(ETH_RECONCILIATION.accountName);
    expect(transactions[0].asset.symbol).toBe(ETH_RECONCILIATION.symbol);
    expect(transactions[0].quantity.equals(ETH_RECONCILIATION.quantity)).toBe(true);
    expect(transactions[0].pricePerUnit?.equals(ETH_RECONCILIATION.pricePerUnit)).toBe(true);
  });

  it("does not replace real ETH transaction history", async () => {
    const account = await testDb.prisma.account.create({ data: { name: ETH_RECONCILIATION.accountName, type: AccountType.EXCHANGE } });
    const asset = await testDb.prisma.asset.create({
      data: { symbol: ETH_RECONCILIATION.symbol, name: "Ethereum", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "ETH" },
    });
    await testDb.prisma.transaction.create({
      data: {
        accountId: account.id,
        assetId: asset.id,
        type: TransactionType.BUY,
        quantity: "0.01",
        pricePerUnit: "2500",
        currency: "USD",
        executedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    await expect(reconcileEthOpeningBalance(testDb.prisma)).rejects.toThrow("real ETH history exists");
    expect(await testDb.prisma.transaction.count()).toBe(1);
  });
});
