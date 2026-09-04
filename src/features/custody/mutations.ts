import { accountCustodianInputSchema, custodianInputSchema } from "@/features/custody/validation";
import { CustodyRepository } from "@/features/custody/repository";

export async function saveCustodianMutation(input: unknown, repository = new CustodyRepository()) {
  const parsed = custodianInputSchema.parse(input);
  const data = { name: parsed.name, category: parsed.category, description: parsed.description || null };
  const custodian = parsed.id
    ? await repository.updateCustodian(parsed.id, data)
    : await repository.createCustodian(data);
  return { ok: true, message: parsed.id ? "Custodian updated." : "Custodian created.", custodian };
}

export async function assignAccountCustodianMutation(input: unknown, repository = new CustodyRepository()) {
  const parsed = accountCustodianInputSchema.parse(input);
  if (parsed.custodianId && !await repository.findCustodian(parsed.custodianId)) {
    throw new Error("Selected custodian does not exist.");
  }
  await repository.assignAccount(parsed.accountId, parsed.custodianId);
  return { ok: true, message: parsed.custodianId ? "Account assigned." : "Account unassigned." };
}
