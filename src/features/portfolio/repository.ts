import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export class PortfolioRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  listAssets() {
    return this.db.asset.findMany({ orderBy: { symbol: "asc" } });
  }

  listAccounts() {
    return this.db.account.findMany({ orderBy: { name: "asc" } });
  }

  listTransactions() {
    return this.db.transaction.findMany({
      include: {
        account: true,
        asset: true,
      },
      orderBy: { executedAt: "desc" },
    });
  }
}
