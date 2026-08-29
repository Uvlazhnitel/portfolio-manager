"use server";

import { CustodianCategory } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { assignAccountCustodianMutation, saveCustodianMutation } from "@/features/custody/mutations";
import { publicErrorMessage } from "@/lib/public-error";

export type CustodyActionState = { ok: boolean; message: string };

export async function saveCustodianAction(_: CustodyActionState, formData: FormData): Promise<CustodyActionState> {
  try {
    const result = await saveCustodianMutation({ id: optional(formData.get("id")), name: formData.get("name"), category: String(formData.get("category") ?? CustodianCategory.OTHER), description: optional(formData.get("description")) });
    revalidate(); return result;
  } catch (error) { return { ok: false, message: publicErrorMessage(error, "Custodian could not be saved.") }; }
}

export async function assignAccountCustodianAction(_: CustodyActionState, formData: FormData): Promise<CustodyActionState> {
  try {
    const result = await assignAccountCustodianMutation({ accountId: formData.get("accountId"), custodianId: optional(formData.get("custodianId")) });
    revalidate(); return result;
  } catch (error) { return { ok: false, message: publicErrorMessage(error, "Account custody could not be updated.") }; }
}

function optional(value: FormDataEntryValue | null) { const text = typeof value === "string" ? value.trim() : ""; return text || null; }
function revalidate() { for (const path of ["/settings", "/portfolio", "/intelligence", "/assistant"]) revalidatePath(path); }
