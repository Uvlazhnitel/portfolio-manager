import { TransactionStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const activeTransactionWhere = { status: TransactionStatus.ACTIVE } satisfies Prisma.TransactionWhereInput;

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
      where: activeTransactionWhere,
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
      where: activeTransactionWhere,
      include: {
        account: true,
        asset: true,
        transactionGroup: true,
      },
      orderBy: { executedAt: "asc" },
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

  findTransactionForAudit(id: string) {
    return this.db.transaction.findUnique({
      where: { id },
      include: {
        account: true,
        asset: true,
        transactionGroup: true,
        replacesTransaction: { include: { account: true, asset: true, transactionGroup: true } },
        replacementTransactions: {
          include: { account: true, asset: true, transactionGroup: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  listGroupTransactionsForAudit(groupId: string) {
    return this.db.transaction.findMany({
      where: { transactionGroupId: groupId },
      include: {
        account: true,
        asset: true,
        transactionGroup: true,
        replacesTransaction: { include: { account: true, asset: true, transactionGroup: true } },
        replacementTransactions: {
          include: { account: true, asset: true, transactionGroup: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  findAsset(id: string) {
    return this.db.asset.findUnique({ where: { id } });
  }

  findAccount(id: string) {
    return this.db.account.findUnique({ where: { id }, include: { custodian: true } });
  }
}
