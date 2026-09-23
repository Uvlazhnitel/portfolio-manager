import {
  AccountType,
  AssetClass,
  AssetType,
  BasisMethod,
  Prisma,
  TransactionGroupKind,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPersonalCfoCapitalFlows,
  decodeCapitalFlowCursor,
  encodeCapitalFlowCursor,
  parseCapitalFlowLimit,
} from "@/features/personal-cfo-integration/capital-flows";
import { personalCfoIdentity } from "@/features/personal-cfo-integration/contract";
import { PersonalCfoIntegrationRepository } from "@/features/personal-cfo-integration/repository";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;
const identity = personalCfoIdentity("test-portfolio");

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("Personal CFO capital-flow contract", () => {
  it("exports only explicit flows with original currency and unavailable legacy amounts", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Flow Account", type: AccountType.BANK } });
    const transferAccount = await testDb.prisma.account.create({ data: { name: "Transfer Target", type: AccountType.BANK } });
    const eur = await testDb.prisma.asset.create({
      data: { symbol: "EUR_FLOW", name: "Euro Flow", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" },
    });
    const usd = await testDb.prisma.asset.create({
      data: { symbol: "USD_FLOW", name: "US Dollar Flow", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" },
    });
    const btc = await testDb.prisma.asset.create({
      data: { symbol: "BTC_FLOW", name: "Bitcoin Flow", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    });
    const baseTime = new Date("2026-01-01T00:00:00.000Z");
    const deposit = await createTransaction({
      id: "flow-deposit",
      accountId: account.id,
      assetId: usd.id,
      type: TransactionType.DEPOSIT,
      quantity: "10",
      pricePerUnit: "1.25",
      currency: "EUR",
      executedAt: new Date("2025-12-01T00:00:00.000Z"),
      updatedAt: new Date(baseTime.getTime() + 1_000),
      note: "private deposit note",
    });
    await createTransaction({
      id: "flow-withdrawal",
      accountId: account.id,
      assetId: eur.id,
      type: TransactionType.WITHDRAWAL,
      quantity: "2.5",
      pricePerUnit: null,
      currency: "EUR",
      executedAt: new Date("2025-12-02T00:00:00.000Z"),
      updatedAt: new Date(baseTime.getTime() + 2_000),
    });
    await createTransaction({
      id: "flow-legacy-unavailable",
      accountId: account.id,
      assetId: btc.id,
      type: TransactionType.DEPOSIT,
      quantity: "0.5",
      pricePerUnit: null,
      currency: "EUR",
      executedAt: new Date("2025-12-03T00:00:00.000Z"),
      updatedAt: new Date(baseTime.getTime() + 3_000),
    });

    const excludedTypes = [
      TransactionType.GIFT,
      TransactionType.INITIAL_BALANCE,
    ];
    for (const [index, type] of excludedTypes.entries()) {
      await createTransaction({
        id: `excluded-${type.toLowerCase()}`,
        accountId: account.id,
        assetId: type === TransactionType.GIFT ? btc.id : eur.id,
        type,
        basisMethod: type === TransactionType.GIFT ? BasisMethod.FAIR_VALUE : BasisMethod.KNOWN_COST,
        quantity: "1",
        pricePerUnit: "1",
        currency: "EUR",
        executedAt: new Date(baseTime.getTime() + 4_000 + index),
        updatedAt: new Date(baseTime.getTime() + 4_000 + index),
      });
    }
    await testDb.prisma.$transaction(async (transaction) => {
      const trade = await transaction.transactionGroup.create({ data: { kind: TransactionGroupKind.TRADE } });
      const transfer = await transaction.transactionGroup.create({ data: { kind: TransactionGroupKind.TRANSFER } });
      await transaction.transaction.createMany({ data: [
        {
          id: "excluded-trade-sell",
          accountId: account.id,
          assetId: eur.id,
          type: TransactionType.SELL,
          quantity: "1",
          pricePerUnit: "1",
          currency: "EUR",
          executedAt: new Date(baseTime.getTime() + 5_000),
          updatedAt: new Date(baseTime.getTime() + 5_000),
          transactionGroupId: trade.id,
        },
        {
          id: "excluded-trade-buy",
          accountId: account.id,
          assetId: btc.id,
          type: TransactionType.BUY,
          quantity: "1",
          pricePerUnit: "1",
          currency: "EUR",
          executedAt: new Date(baseTime.getTime() + 5_000),
          updatedAt: new Date(baseTime.getTime() + 5_000),
          transactionGroupId: trade.id,
        },
        {
          id: "excluded-transfer-out",
          accountId: account.id,
          assetId: eur.id,
          type: TransactionType.TRANSFER_OUT,
          quantity: "1",
          currency: "EUR",
          executedAt: new Date(baseTime.getTime() + 6_000),
          updatedAt: new Date(baseTime.getTime() + 6_000),
          transactionGroupId: transfer.id,
        },
        {
          id: "excluded-transfer-in",
          accountId: transferAccount.id,
          assetId: eur.id,
          type: TransactionType.TRANSFER_IN,
          quantity: "1",
          currency: "EUR",
          executedAt: new Date(baseTime.getTime() + 6_000),
          updatedAt: new Date(baseTime.getTime() + 6_000),
          transactionGroupId: transfer.id,
        },
      ] });
    });

    const response = await buildPersonalCfoCapitalFlows({
      identity,
      cursor: null,
      limit: "100",
      repository: new PersonalCfoIntegrationRepository(testDb.prisma),
    });
    expect(response.items.map((item) => item.revisionId)).toEqual([
      "flow-deposit",
      "flow-withdrawal",
      "flow-legacy-unavailable",
    ]);
    expect(response.items[0]).toEqual(expect.objectContaining({
      eventId: deposit.id,
      revisionId: deposit.id,
      sourceTransactionId: deposit.id,
      status: "ACTIVE",
      direction: "contribution",
      amount: "12.5",
      amountUnavailableReason: null,
      currency: "EUR",
    }));
    expect(response.items[1]).toEqual(expect.objectContaining({
      direction: "withdrawal",
      amount: "2.5",
      currency: "EUR",
    }));
    expect(response.items[2]).toEqual(expect.objectContaining({
      amount: null,
      amountUnavailableReason: "MISSING_OR_NON_POSITIVE_ORIGINAL_AMOUNT",
    }));
    expect(JSON.stringify(response)).not.toContain("private deposit note");
    expect(new Set(response.items.map((item) => item.revisionFingerprint)).size).toBe(3);
    expect(response.items.every((item) => item.revisionFingerprint.match(/^sha256:[a-f0-9]{64}$/))).toBe(true);
  });

  it("keeps replacement chains replay-safe and represents a void explicitly", async () => {
    const account = await testDb.prisma.account.create({ data: { name: "Revision Account", type: AccountType.BANK } });
    const eur = await testDb.prisma.asset.create({
      data: { symbol: "EUR_REVISION", name: "Euro Revision", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "EUR" },
    });
    const original = await createTransaction({
      id: "revision-original",
      accountId: account.id,
      assetId: eur.id,
      type: TransactionType.DEPOSIT,
      quantity: "100",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      status: TransactionStatus.REPLACED,
      statusChangedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const replacement = await createTransaction({
      id: "revision-replacement",
      accountId: account.id,
      assetId: eur.id,
      type: TransactionType.DEPOSIT,
      quantity: "125",
      pricePerUnit: "1",
      currency: "EUR",
      executedAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:01.000Z"),
      status: TransactionStatus.VOIDED,
      statusChangedAt: new Date("2026-02-01T00:00:01.000Z"),
      replacesTransactionId: original.id,
    });

    const request = {
      identity,
      cursor: null,
      limit: "100",
      repository: new PersonalCfoIntegrationRepository(testDb.prisma),
    };
    const first = await buildPersonalCfoCapitalFlows(request);
    const replay = await buildPersonalCfoCapitalFlows(request);
    expect(replay).toEqual(first);
    const originalItem = first.items.find((item) => item.revisionId === original.id)!;
    const replacementItem = first.items.find((item) => item.revisionId === replacement.id)!;
    expect(originalItem).toEqual(expect.objectContaining({
      eventId: original.id,
      status: "REPLACED",
      replacesRevisionId: null,
      replacementRevisionIds: [replacement.id],
    }));
    expect(replacementItem).toEqual(expect.objectContaining({
      eventId: original.id,
      status: "VOIDED",
      replacesRevisionId: original.id,
      replacementRevisionIds: [],
    }));
  });

  it("paginates deterministically and surfaces a historical correction after a checkpoint", async () => {
    const repository = new PersonalCfoIntegrationRepository(testDb.prisma);
    const firstPage = await buildPersonalCfoCapitalFlows({ identity, cursor: null, limit: "2", repository });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();
    const position = decodeCapitalFlowCursor(firstPage.nextCursor);
    expect(position).toEqual({
      changedAt: new Date(firstPage.items[1].changedAt),
      revisionId: firstPage.items[1].revisionId,
    });

    const secondPage = await buildPersonalCfoCapitalFlows({
      identity,
      cursor: firstPage.nextCursor,
      limit: "2",
      repository,
    });
    expect(secondPage.items.every((item) => (
      item.changedAt > firstPage.items[1].changedAt
      || (item.changedAt === firstPage.items[1].changedAt && item.revisionId > firstPage.items[1].revisionId)
    ))).toBe(true);

    const historical = await testDb.prisma.transaction.create({
      data: {
        id: "historical-correction-source",
        accountId: firstPage.items[0].accountId,
        assetId: firstPage.items[0].assetId,
        type: TransactionType.DEPOSIT,
        quantity: "50",
        pricePerUnit: "1",
        currency: "EUR",
        executedAt: new Date("2020-01-01T00:00:00.000Z"),
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    const correctionTime = new Date("2026-12-01T00:00:00.000Z");
    await testDb.prisma.transaction.update({
      where: { id: historical.id },
      data: { status: TransactionStatus.REPLACED, statusChangedAt: correctionTime, updatedAt: correctionTime },
    });
    await testDb.prisma.transaction.create({
      data: {
        id: "historical-correction-revision",
        accountId: historical.accountId,
        assetId: historical.assetId,
        type: TransactionType.DEPOSIT,
        quantity: "55",
        pricePerUnit: "1",
        currency: "EUR",
        executedAt: historical.executedAt,
        replacesTransactionId: historical.id,
        createdAt: correctionTime,
        updatedAt: new Date(correctionTime.getTime() + 1),
      },
    });
    const afterCheckpoint = await buildPersonalCfoCapitalFlows({
      identity,
      cursor: firstPage.nextCursor,
      limit: "500",
      repository,
    });
    expect(afterCheckpoint.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ revisionId: historical.id, status: "REPLACED", eventId: historical.id }),
      expect.objectContaining({ revisionId: "historical-correction-revision", eventId: historical.id }),
    ]));
  });

  it("validates limits and opaque cursors", () => {
    expect(parseCapitalFlowLimit(null)).toBe(100);
    expect(parseCapitalFlowLimit("500")).toBe(500);
    for (const value of ["", "0", "-1", "1.5", "501", "not-a-number"]) {
      expect(() => parseCapitalFlowLimit(value)).toThrow();
    }
    const position = { changedAt: new Date("2026-09-23T00:00:00.000Z"), revisionId: "revision" };
    expect(decodeCapitalFlowCursor(encodeCapitalFlowCursor(position))).toEqual(position);
    for (const cursor of ["", "not-base64-json", Buffer.from("{}").toString("base64url")]) {
      expect(() => decodeCapitalFlowCursor(cursor)).toThrow();
    }
  });
});

async function createTransaction(input: {
  id: string;
  accountId: string;
  assetId: string;
  type: TransactionType;
  basisMethod?: BasisMethod | null;
  quantity: string;
  pricePerUnit: string | null;
  currency: string;
  executedAt: Date;
  updatedAt: Date;
  note?: string;
  transactionGroupId?: string | null;
  status?: TransactionStatus;
  statusChangedAt?: Date | null;
  replacesTransactionId?: string | null;
}) {
  return testDb.prisma.transaction.create({
    data: {
      ...input,
      basisMethod: input.basisMethod ?? null,
      quantity: new Prisma.Decimal(input.quantity),
      pricePerUnit: input.pricePerUnit === null ? null : new Prisma.Decimal(input.pricePerUnit),
      note: input.note ?? null,
      transactionGroupId: input.transactionGroupId ?? null,
      status: input.status ?? TransactionStatus.ACTIVE,
      statusChangedAt: input.statusChangedAt ?? null,
      replacesTransactionId: input.replacesTransactionId ?? null,
      createdAt: input.updatedAt,
    },
  });
}
