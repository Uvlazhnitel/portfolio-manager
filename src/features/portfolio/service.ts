import { TransactionType, type Transaction } from "@prisma/client";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { serializeDecimal, serializeNullableDecimal } from "@/lib/db/decimal";

const positiveQuantityTypes = new Set<TransactionType>([
  TransactionType.INITIAL_BALANCE,
  TransactionType.BUY,
  TransactionType.DEPOSIT,
  TransactionType.TRANSFER_IN,
]);

const negativeQuantityTypes = new Set<TransactionType>([
  TransactionType.SELL,
  TransactionType.WITHDRAWAL,
  TransactionType.TRANSFER_OUT,
]);

export type DerivedHolding = {
  assetId: string;
  accountId: string;
  quantity: string;
};

export class PortfolioService {
  constructor(private readonly repository = new PortfolioRepository()) {}

  listAssets() {
    return this.repository.listAssets();
  }

  listAccounts() {
    return this.repository.listAccounts();
  }

  async getDerivedHoldings(): Promise<DerivedHolding[]> {
    const transactions = await this.repository.listTransactions();
    return deriveHoldingsFromTransactions(transactions);
  }
}

export function deriveHoldingsFromTransactions(transactions: Transaction[]): DerivedHolding[] {
  const quantities = new Map<string, number>();

  for (const transaction of transactions) {
    const key = `${transaction.accountId}:${transaction.assetId}`;
    const quantity = Number(transaction.quantity.toString());
    const current = quantities.get(key) ?? 0;

    if (positiveQuantityTypes.has(transaction.type)) {
      quantities.set(key, current + quantity);
    }

    if (negativeQuantityTypes.has(transaction.type)) {
      quantities.set(key, current - quantity);
    }
  }

  return Array.from(quantities.entries()).map(([key, quantity]) => {
    const [accountId, assetId] = key.split(":");

    return {
      accountId,
      assetId,
      quantity: String(quantity),
    };
  });
}

export function serializeTransaction(transaction: Transaction) {
  return {
    ...transaction,
    quantity: serializeDecimal(transaction.quantity),
    pricePerUnit: serializeNullableDecimal(transaction.pricePerUnit),
    fee: serializeNullableDecimal(transaction.fee),
  };
}
