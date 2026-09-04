import type { CustodianCategory } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { DbClient } from "@/lib/db/types";

type CustodianWrite = {
  name: string;
  category: CustodianCategory;
  description: string | null;
};

export class CustodyRepository {
  constructor(private readonly db: DbClient = prisma) {}

  createCustodian(data: CustodianWrite) {
    return this.db.custodian.create({ data });
  }

  updateCustodian(id: string, data: CustodianWrite) {
    return this.db.custodian.update({ where: { id }, data });
  }

  findCustodian(id: string) {
    return this.db.custodian.findUnique({ where: { id }, select: { id: true } });
  }

  assignAccount(accountId: string, custodianId: string | null) {
    return this.db.account.update({ where: { id: accountId }, data: { custodianId } });
  }
}
