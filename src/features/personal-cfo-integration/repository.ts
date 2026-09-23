import "server-only";

import { TransactionType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DbClient } from "@/lib/db/types";

const capitalFlowTypes = [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL] as const;

export type CapitalFlowCursorPosition = {
  changedAt: Date;
  revisionId: string;
};

export class PersonalCfoIntegrationRepository {
  constructor(private readonly db: DbClient = prisma) {}

  listCapitalFlowPage(input: { after: CapitalFlowCursorPosition | null; take: number }) {
    const afterWhere: Prisma.TransactionWhereInput | undefined = input.after
      ? {
          OR: [
            { updatedAt: { gt: input.after.changedAt } },
            { updatedAt: input.after.changedAt, id: { gt: input.after.revisionId } },
          ],
        }
      : undefined;
    return this.db.transaction.findMany({
      where: {
        type: { in: [...capitalFlowTypes] },
        ...afterWhere,
      },
      include: {
        asset: { select: { currency: true, assetType: true } },
        replacementTransactions: { select: { id: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: input.take,
    });
  }

  listTransactionLineage() {
    return this.db.transaction.findMany({
      select: { id: true, replacesTransactionId: true },
    });
  }
}

export type CapitalFlowRevisionRow = Awaited<ReturnType<PersonalCfoIntegrationRepository["listCapitalFlowPage"]>>[number];
