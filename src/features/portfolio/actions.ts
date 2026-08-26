"use server";

import { AccountType, AssetClass, AssetType, TransactionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createAccountMutation,
  createTransferMutation,
  createTransactionMutation,
  deleteTransactionMutation,
  type PortfolioMutationResult,
} from "@/features/portfolio/mutations";
import { publicErrorMessage } from "@/lib/public-error";
import { StrategyRepository } from "@/features/strategy/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

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
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;

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
                currency: String(formData.get("newAssetCurrency") ?? baseCurrency),
              }
            : undefined,
        quantity: nullableString(formData.get("quantity")) ?? undefined,
        physicalGoldWeightTroyOunces: nullableString(formData.get("physicalGoldWeightTroyOunces")) ?? undefined,
        pricePerUnit: nullableString(formData.get("pricePerUnit")) ?? undefined,
        totalAmount: nullableString(formData.get("totalAmount")) ?? undefined,
        totalPurchaseCost: nullableString(formData.get("totalPurchaseCost")) ?? undefined,
        fee: nullableString(formData.get("fee")) ?? undefined,
        currency: String(formData.get("currency") ?? baseCurrency),
        executedAt: String(formData.get("executedAt") ?? ""),
        note: nullableString(formData.get("note")) ?? undefined,
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function createTransferAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;

  try {
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;

    return await withPortfolioRevalidation(
      createTransferMutation({
        assetId: String(formData.get("assetId") ?? ""),
        fromAccountId: String(formData.get("fromAccountId") ?? ""),
        toAccountId: String(formData.get("toAccountId") ?? ""),
        quantity: nullableString(formData.get("quantity")) ?? undefined,
        physicalGoldWeightTroyOunces: nullableString(formData.get("physicalGoldWeightTroyOunces")) ?? undefined,
        currency: String(formData.get("currency") ?? baseCurrency),
        executedAt: String(formData.get("executedAt") ?? ""),
        note: nullableString(formData.get("note")) ?? undefined,
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function createPositionAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;

  try {
    const existingAssetId = nullableString(formData.get("existingAssetId"));
    const imageUrl = safeCoinGeckoImageUrl(nullableString(formData.get("newAssetImageUrl")));
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
    const transactionType = parseImplementedTransactionType(String(formData.get("type") ?? TransactionType.INITIAL_BALANCE));
    return await withPortfolioRevalidation(
      createTransactionMutation({
        type: transactionType,
        accountId: String(formData.get("accountId") ?? ""),
        assetMode: existingAssetId ? "existing" : "new",
        assetId: existingAssetId ?? undefined,
        newAsset: existingAssetId
          ? undefined
          : {
              symbol: String(formData.get("newAssetSymbol") ?? ""),
              name: String(formData.get("newAssetName") ?? ""),
              assetClass: String(formData.get("newAssetClass") ?? AssetClass.CRYPTO) as AssetClass,
              assetType: String(formData.get("newAssetType") ?? AssetType.CRYPTO) as AssetType,
              currency: String(formData.get("newAssetCurrency") ?? baseCurrency),
              externalId: nullableString(formData.get("newAssetExternalId")),
              metadata: imageUrl ? { imageUrl } : undefined,
            },
        quantity: nullableString(formData.get("quantity")) ?? undefined,
        physicalGoldWeightTroyOunces: nullableString(formData.get("physicalGoldWeightTroyOunces")) ?? undefined,
        pricePerUnit: nullableString(formData.get("pricePerUnit")) ?? undefined,
        totalAmount: nullableString(formData.get("totalAmount")) ?? nullableString(formData.get("totalPurchaseCost")) ?? undefined,
        fee: nullableString(formData.get("fee")) ?? undefined,
        currency: baseCurrency,
        executedAt: String(formData.get("executedAt") ?? ""),
        note: nullableString(formData.get("note")) ?? undefined,
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
    value === TransactionType.SELL ||
    value === TransactionType.DEPOSIT ||
    value === TransactionType.WITHDRAWAL ||
    value === TransactionType.TRANSFER_IN ||
    value === TransactionType.TRANSFER_OUT
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

function safeCoinGeckoImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["assets.coingecko.com", "coin-images.coingecko.com"].includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function toActionError(error: unknown): PortfolioActionState {
  return {
    ok: false,
    message: publicErrorMessage(error, "Portfolio change could not be saved."),
  };
}

async function withPortfolioRevalidation<T extends PortfolioMutationResult>(mutation: Promise<T>) {
  const result = await mutation;
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
  return result;
}
