import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { accountCustodianInputSchema, custodianInputSchema } from "@/features/custody/validation";

export async function saveCustodianMutation(input: unknown, db: PrismaClient = prisma) {
  const parsed = custodianInputSchema.parse(input);
  const data = { name: parsed.name, category: parsed.category, description: parsed.description || null };
  const custodian = parsed.id
    ? await db.custodian.update({ where: { id: parsed.id }, data })
    : await db.custodian.create({ data });
  return { ok: true, message: parsed.id ? "Custodian updated." : "Custodian created.", custodian };
}

export async function assignAccountCustodianMutation(input: unknown, db: PrismaClient = prisma) {
  const parsed = accountCustodianInputSchema.parse(input);
  if (parsed.custodianId && !await db.custodian.findUnique({ where: { id: parsed.custodianId }, select: { id: true } })) {
    throw new Error("Selected custodian does not exist.");
  }
  await db.account.update({ where: { id: parsed.accountId }, data: { custodianId: parsed.custodianId } });
  return { ok: true, message: parsed.custodianId ? "Account assigned." : "Account unassigned." };
}
