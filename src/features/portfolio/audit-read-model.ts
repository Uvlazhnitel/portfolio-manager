import type { TransactionStatus, TransactionType } from "@prisma/client";
import { PortfolioRepository } from "@/features/portfolio/repository";

type AuditTransaction = NonNullable<Awaited<ReturnType<PortfolioRepository["findTransactionForAudit"]>>>;

export type TransactionAuditEvent =
  | {
      action: "CREATED";
      transactionId: string;
      transactionGroupId: string | null;
      occurredAt: string;
      status: TransactionStatus;
      reason: string | null;
      replacesTransactionId: string | null;
      replacementTransactionIds: string[];
      type: TransactionType;
      assetSymbol: string;
      accountName: string;
    }
  | {
      action: "CORRECTED";
      transactionId: string;
      transactionGroupId: string | null;
      occurredAt: string;
      status: TransactionStatus;
      reason: string | null;
      replacesTransactionId: string;
      replacementTransactionIds: string[];
      type: TransactionType;
      assetSymbol: string;
      accountName: string;
    }
  | {
      action: "REPLACED" | "VOIDED";
      transactionId: string;
      transactionGroupId: string | null;
      occurredAt: string;
      status: TransactionStatus;
      reason: string | null;
      replacesTransactionId: string | null;
      replacementTransactionIds: string[];
      type: TransactionType;
      assetSymbol: string;
      accountName: string;
    };

export type TransactionAuditReadModel = {
  transactionId: string;
  transactionGroupId: string | null;
  events: TransactionAuditEvent[];
};

export async function getTransactionAuditReadModel(
  transactionId: string,
  repository = new PortfolioRepository(),
): Promise<TransactionAuditReadModel | null> {
  const transaction = await repository.findTransactionForAudit(transactionId);
  if (!transaction) return null;
  const chain = await loadReplacementChain(transaction, repository);
  return {
    transactionId,
    transactionGroupId: transaction.transactionGroupId,
    events: chain.flatMap(transactionAuditEvents).sort(compareEvents),
  };
}

export async function getTransactionGroupAuditReadModel(
  groupId: string,
  repository = new PortfolioRepository(),
): Promise<TransactionAuditReadModel | null> {
  const transactions = await repository.listGroupTransactionsForAudit(groupId);
  if (transactions.length === 0) return null;
  const chain = (await Promise.all(transactions.map((transaction) => loadReplacementChain(transaction, repository))))
    .flat();
  const unique = new Map(chain.map((transaction) => [transaction.id, transaction]));
  return {
    transactionId: "",
    transactionGroupId: groupId,
    events: [...unique.values()].flatMap(transactionAuditEvents).sort(compareEvents),
  };
}

async function loadReplacementChain(
  transaction: AuditTransaction,
  repository: PortfolioRepository,
): Promise<AuditTransaction[]> {
  const byId = new Map<string, AuditTransaction>();
  const visit = async (current: AuditTransaction | null) => {
    if (!current || byId.has(current.id)) return;
    byId.set(current.id, current);
    if (current.replacesTransactionId) {
      await visit(await repository.findTransactionForAudit(current.replacesTransactionId));
    }
    for (const replacement of current.replacementTransactions) {
      await visit(await repository.findTransactionForAudit(replacement.id));
    }
  };
  await visit(transaction);
  return [...byId.values()];
}

function transactionAuditEvents(transaction: AuditTransaction): TransactionAuditEvent[] {
  const base = {
    transactionId: transaction.id,
    transactionGroupId: transaction.transactionGroupId,
    status: transaction.status,
    reason: transaction.statusReason,
    replacementTransactionIds: transaction.replacementTransactions.map((replacement) => replacement.id),
    type: transaction.type,
    assetSymbol: transaction.asset.symbol,
    accountName: transaction.account.name,
  };
  const events: TransactionAuditEvent[] = [{
    ...base,
    action: "CREATED",
    occurredAt: transaction.createdAt.toISOString(),
    replacesTransactionId: transaction.replacesTransactionId,
  }];
  if (transaction.replacesTransactionId) {
    events.push({
      ...base,
      action: "CORRECTED",
      occurredAt: transaction.createdAt.toISOString(),
      replacesTransactionId: transaction.replacesTransactionId,
    });
  }
  if (transaction.status === "REPLACED" || transaction.status === "VOIDED") {
    events.push({
      ...base,
      action: transaction.status,
      occurredAt: (transaction.statusChangedAt ?? transaction.updatedAt).toISOString(),
      replacesTransactionId: transaction.replacesTransactionId,
    });
  }
  return events;
}

function compareEvents(left: TransactionAuditEvent, right: TransactionAuditEvent) {
  const time = left.occurredAt.localeCompare(right.occurredAt);
  if (time !== 0) return time;
  return left.transactionId.localeCompare(right.transactionId);
}
