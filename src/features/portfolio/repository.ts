import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export class PortfolioRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  listAssets() {
    return this.db.asset.findMany({ orderBy: { symbol: "asc" } });
  }

  listAccounts() {
    return this.db.account.findMany({ include: { custodian: true }, orderBy: { name: "asc" } });
  }

  listCustodians() {
    return this.db.custodian.findMany({ include: { accounts: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
  }

  listTransactions() {
    return this.db.transaction.findMany({
      include: {
        account: true,
        asset: true,
        transactionGroup: true,
      },
      orderBy: { executedAt: "desc" },
    });
  }

  listTransactionsChronological() {
    return this.db.transaction.findMany({
      include: {
        account: true,
        asset: true,
        transactionGroup: true,
      },
      orderBy: { executedAt: "asc" },
    });
  }

  listDailyPrices(currency: string) {
    return this.db.dailyMarketPrice.findMany({
      where: { currency },
      orderBy: [{ date: "asc" }, { assetId: "asc" }],
    });
  }

  createAccount(data: Prisma.AccountCreateInput) {
    return this.db.account.create({ data });
  }

  createAsset(data: Prisma.AssetCreateInput) {
    return this.db.asset.create({ data });
  }

  createTransaction(data: Prisma.TransactionUncheckedCreateInput) {
    return this.db.transaction.create({ data });
  }

  deleteTransaction(id: string) {
    return this.db.transaction.delete({ where: { id } });
  }

  findAsset(id: string) {
    return this.db.asset.findUnique({ where: { id } });
  }

  findAccount(id: string) {
    return this.db.account.findUnique({ where: { id }, include: { custodian: true } });
  }
}
