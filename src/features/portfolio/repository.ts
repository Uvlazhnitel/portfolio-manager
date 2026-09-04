import { TransactionStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { AssetRepository } from "@/features/assets/repository";
import { prisma } from "@/lib/db/client";
import { runInSerializableTransaction } from "@/lib/db/transaction";
import type { DbClient } from "@/lib/db/types";

const activeTransactionWhere = { status: TransactionStatus.ACTIVE } satisfies Prisma.TransactionWhereInput;

export class PortfolioRepository {
  readonly assets: AssetRepository;

  constructor(private readonly db: DbClient = prisma) {
    this.assets = new AssetRepository(db);
  }

  async withSerializableTransaction<T>(operation: (repository: PortfolioRepository) => Promise<T>) {
    if (typeof (this.db as PrismaClient).$transaction !== "function") {
      throw new Error("A root Prisma client is required to start a transaction.");
    }
    return runInSerializableTransaction(this.db as PrismaClient, (transaction) => (
      operation(new PortfolioRepository(transaction))
    ));
  }

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

  createTransactions(data: Prisma.TransactionCreateManyInput[]) {
    return this.db.transaction.createMany({ data });
  }

  createTransactionGroup(kind: Prisma.TransactionGroupCreateInput["kind"]) {
    return this.db.transactionGroup.create({ data: { kind } });
  }

  findTransaction(id: string) {
    return this.db.transaction.findUnique({ where: { id } });
  }

  findTransactionWithAsset(id: string) {
    return this.db.transaction.findUnique({ where: { id }, include: { asset: true } });
  }

  findTransactionGroup(id: string) {
    return this.db.transactionGroup.findUnique({
      where: { id },
      include: {
        transactions: {
          where: activeTransactionWhere,
          orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  listActiveTransactionsThroughDate(input: {
    accountId: string;
    assetId: string;
    executedAt: Date;
    excludedGroupId?: string;
  }) {
    return this.db.transaction.findMany({
      where: {
        ...activeTransactionWhere,
        accountId: input.accountId,
        assetId: input.assetId,
        executedAt: { lte: input.executedAt },
        ...(input.excludedGroupId
          ? { OR: [{ transactionGroupId: null }, { transactionGroupId: { not: input.excludedGroupId } }] }
          : {}),
      },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
  }

  listActiveChronology(accountId: string, assetId: string) {
    return this.db.transaction.findMany({
      where: { ...activeTransactionWhere, accountId, assetId },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
  }

  updateActiveTransactionStatus(input: {
    ids: string[];
    status: typeof TransactionStatus.VOIDED | typeof TransactionStatus.REPLACED;
    reason: string | null;
    changedAt: Date;
  }) {
    return this.db.transaction.updateMany({
      where: { id: { in: input.ids }, status: TransactionStatus.ACTIVE },
      data: {
        status: input.status,
        statusChangedAt: input.changedAt,
        statusReason: input.reason,
      },
    });
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

  findCustodian(id: string) {
    return this.db.custodian.findUnique({ where: { id }, select: { id: true } });
  }
}
