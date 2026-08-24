import type { Transaction } from "@prisma/client";
import { calculateHoldings } from "@/features/portfolio-engine";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { serializeDecimal, serializeNullableDecimal } from "@/lib/db/decimal";

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
  return calculateHoldings(transactions);
}

export function serializeTransaction(transaction: Transaction) {
  return {
    ...transaction,
    quantity: serializeDecimal(transaction.quantity),
    pricePerUnit: serializeNullableDecimal(transaction.pricePerUnit),
    fee: serializeNullableDecimal(transaction.fee),
  };
}
