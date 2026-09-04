import { TransactionStatus } from "@prisma/client";
import type { EngineTransaction } from "@/features/portfolio-engine/types";

export function isActiveEngineTransaction(transaction: EngineTransaction) {
  return transaction.status === undefined ||
    transaction.status === null ||
    String(transaction.status) === TransactionStatus.ACTIVE;
}

export function activeEngineTransactions<T extends EngineTransaction>(transactions: T[]): T[] {
  return transactions.filter(isActiveEngineTransaction);
}
