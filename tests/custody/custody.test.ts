import { AccountType, CustodianCategory } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignAccountCustodianMutation, saveCustodianMutation } from "@/features/custody/mutations";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

describe("custodian persistence", () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase(); });
  afterAll(async () => { await db.cleanup(); });

  it("keeps legacy accounts valid without a custodian", async () => {
    const account = await db.prisma.account.create({ data: { name: "Legacy wallet", type: AccountType.WALLET, description: "Preserved" } });
    expect(account).toEqual(expect.objectContaining({ name: "Legacy wallet", description: "Preserved", custodianId: null }));
  });

  it("creates and edits custodians and aggregates multiple linked accounts", async () => {
    const saved = await saveCustodianMutation({ name: "Bybit", category: CustodianCategory.EXCHANGE }, db.prisma);
    const spot = await db.prisma.account.create({ data: { name: "Bybit Spot", type: AccountType.EXCHANGE } });
    const earn = await db.prisma.account.create({ data: { name: "Bybit Earn", type: AccountType.EXCHANGE } });
    await assignAccountCustodianMutation({ accountId: spot.id, custodianId: saved.custodian.id }, db.prisma);
    await assignAccountCustodianMutation({ accountId: earn.id, custodianId: saved.custodian.id }, db.prisma);
    await saveCustodianMutation({ id: saved.custodian.id, name: "Bybit Global", category: CustodianCategory.EXCHANGE, description: "Counterparty" }, db.prisma);
    const custodian = await db.prisma.custodian.findUniqueOrThrow({ where: { id: saved.custodian.id }, include: { accounts: true } });
    expect(custodian.accounts.map((account) => account.name).sort()).toEqual(["Bybit Earn", "Bybit Spot"]);
    expect(custodian).toEqual(expect.objectContaining({ name: "Bybit Global", description: "Counterparty" }));
  });
});
