"use server";

import { AccountType, AssetClass, AssetType, TransactionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createAccountMutation,
  createTransactionMutation,
  deleteTransactionMutation,
  type PortfolioMutationResult,
} from "@/features/portfolio/mutations";

export type PortfolioActionState = PortfolioMutationResult;

const initialState: PortfolioActionState = { ok: false, message: "" };

export async function createAccountAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;

  try {
    return await withPortfolioRevalidation(
      createAccountMutation({
        name: String(formData.get("name") ?? ""),
        type: String(formData.get("type") ?? AccountType.OTHER) as AccountType,
        description: nullableString(formData.get("description")),
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function createTransactionAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;

  try {
    const assetMode = String(formData.get("assetMode") ?? "existing");
    const rawTransactionType = String(formData.get("type") ?? TransactionType.INITIAL_BALANCE);
    const transactionType = parseImplementedTransactionType(rawTransactionType);

    return await withPortfolioRevalidation(
      createTransactionMutation({
        type: transactionType,
        accountId: String(formData.get("accountId") ?? ""),
        assetMode: assetMode === "new" ? "new" : "existing",
        assetId: nullableString(formData.get("assetId")) ?? undefined,
        newAsset:
          assetMode === "new"
            ? {
                symbol: String(formData.get("newAssetSymbol") ?? ""),
                name: String(formData.get("newAssetName") ?? ""),
                assetClass: String(formData.get("newAssetClass") ?? AssetClass.OTHER) as AssetClass,
                assetType: String(formData.get("newAssetType") ?? AssetType.OTHER) as AssetType,
                currency: String(formData.get("newAssetCurrency") ?? "EUR"),
              }
            : undefined,
        quantity: nullableString(formData.get("quantity")) ?? undefined,
        physicalGoldWeightGrams: nullableString(formData.get("physicalGoldWeightGrams")) ?? undefined,
        pricePerUnit: nullableString(formData.get("pricePerUnit")) ?? undefined,
        totalPurchaseCost: nullableString(formData.get("totalPurchaseCost")) ?? undefined,
        fee: nullableString(formData.get("fee")) ?? undefined,
        currency: String(formData.get("currency") ?? "EUR"),
        executedAt: String(formData.get("executedAt") ?? ""),
        note: nullableString(formData.get("note")) ?? undefined,
        allowOversell: formData.get("allowOversell") === "on",
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
}

function parseImplementedTransactionType(value: string) {
  if (
    value === TransactionType.INITIAL_BALANCE ||
    value === TransactionType.BUY ||
    value === TransactionType.SELL
  ) {
    return value;
  }

  throw new Error("This transaction type is not implemented yet.");
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  await withPortfolioRevalidation(deleteTransactionMutation(String(formData.get("id") ?? "")));
}

function nullableString(value: FormDataEntryValue | null) {
  if (value === null) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function toActionError(error: unknown): PortfolioActionState {
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong.",
  };
}

async function withPortfolioRevalidation<T extends PortfolioMutationResult>(mutation: Promise<T>) {
  const result = await mutation;
  revalidatePath("/portfolio");
  return result;
}
