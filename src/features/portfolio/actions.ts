"use server";

import { AccountType, AssetClass, AssetType, BasisMethod, TransactionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createAccountMutation,
  createTradeMutation,
  createTransferMutation,
  createTransactionMutation,
  deleteTransactionGroupMutation,
  deleteTransactionMutation,
  linkAssetQuoteMutation,
  updateTradeMutation,
  updateTransferMutation,
  updateTransactionMutation,
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
        custodianId: nullableString(formData.get("custodianId")),
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
        basisMethod: nullableString(formData.get("basisMethod")) as BasisMethod | undefined,
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
                quoteProvider: nullableString(formData.get("newAssetQuoteProvider")) as "ALPHA_VANTAGE" | "TWELVE_DATA" | null,
                quoteSymbol: nullableString(formData.get("newAssetQuoteSymbol")),
                quoteMicCode: nullableString(formData.get("newAssetQuoteMicCode")),
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

export async function createTradeAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;
  try {
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
    return await withPortfolioRevalidation(createTradeMutation({
      sourceAccountId: String(formData.get("sourceAccountId") ?? ""),
      sourceAssetId: String(formData.get("sourceAssetId") ?? ""),
      sourceQuantity: String(formData.get("sourceQuantity") ?? ""),
      sourcePricePerUnit: nullableString(formData.get("sourcePricePerUnit")) ?? undefined,
      sourceTotalAmount: nullableString(formData.get("sourceTotalAmount")) ?? undefined,
      destinationAccountId: String(formData.get("destinationAccountId") ?? ""),
      destinationAssetId: String(formData.get("destinationAssetId") ?? ""),
      destinationQuantity: String(formData.get("destinationQuantity") ?? ""),
      fee: nullableString(formData.get("fee")) ?? undefined,
      currency: baseCurrency,
      executedAt: String(formData.get("executedAt") ?? ""),
      note: nullableString(formData.get("note")) ?? undefined,
    }));
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
        basisMethod: nullableString(formData.get("basisMethod")) as BasisMethod | undefined,
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
              quoteProvider: nullableString(formData.get("newAssetQuoteProvider")) as "ALPHA_VANTAGE" | "TWELVE_DATA" | null,
              quoteSymbol: nullableString(formData.get("newAssetQuoteSymbol")),
              quoteMicCode: nullableString(formData.get("newAssetQuoteMicCode")),
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

export async function linkAssetQuoteAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;
  try {
    return await withPortfolioRevalidation(linkAssetQuoteMutation({
      assetId: String(formData.get("assetId") ?? ""),
      currency: String(formData.get("quoteCurrency") ?? ""),
      quoteProvider: String(formData.get("quoteProvider") ?? "") as "ALPHA_VANTAGE" | "TWELVE_DATA",
      quoteSymbol: String(formData.get("quoteSymbol") ?? ""),
      quoteMicCode: nullableString(formData.get("quoteMicCode")),
    }));
  } catch (error) {
    return toActionError(error);
  }
}

function parseImplementedTransactionType(value: string) {
  if (
    value === TransactionType.INITIAL_BALANCE ||
    value === TransactionType.GIFT ||
    value === TransactionType.BUY ||
    value === TransactionType.SELL ||
    value === TransactionType.DEPOSIT ||
    value === TransactionType.WITHDRAWAL
  ) {
    return value;
  }

  throw new Error("This transaction type is not implemented yet.");
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  await withPortfolioRevalidation(deleteTransactionMutation({
    id: String(formData.get("id") ?? ""),
    auditReason: nullableString(formData.get("auditReason")),
  }));
}

export async function deleteTransactionGroupAction(formData: FormData): Promise<void> {
  await withPortfolioRevalidation(deleteTransactionGroupMutation({
    groupId: String(formData.get("groupId") ?? ""),
    auditReason: nullableString(formData.get("auditReason")),
  }));
}

export async function updateTransferAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;
  try {
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
    return await withPortfolioRevalidation(updateTransferMutation({
      groupId: String(formData.get("groupId") ?? ""),
      assetId: String(formData.get("assetId") ?? ""),
      fromAccountId: String(formData.get("fromAccountId") ?? ""),
      toAccountId: String(formData.get("toAccountId") ?? ""),
      quantity: nullableString(formData.get("quantity")) ?? undefined,
      physicalGoldWeightTroyOunces: nullableString(formData.get("physicalGoldWeightTroyOunces")) ?? undefined,
      currency: baseCurrency,
      executedAt: String(formData.get("executedAt") ?? ""),
      note: nullableString(formData.get("note")) ?? undefined,
      auditReason: nullableString(formData.get("auditReason")) ?? undefined,
    }));
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateTradeAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;
  try {
    const strategy = await new StrategyRepository().findActiveStrategy();
    const baseCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
    return await withPortfolioRevalidation(updateTradeMutation({
      groupId: String(formData.get("groupId") ?? ""),
      sourceAccountId: String(formData.get("sourceAccountId") ?? ""),
      sourceAssetId: String(formData.get("sourceAssetId") ?? ""),
      sourceQuantity: String(formData.get("sourceQuantity") ?? ""),
      sourcePricePerUnit: nullableString(formData.get("sourcePricePerUnit")) ?? undefined,
      sourceTotalAmount: nullableString(formData.get("sourceTotalAmount")) ?? undefined,
      destinationAccountId: String(formData.get("destinationAccountId") ?? ""),
      destinationAssetId: String(formData.get("destinationAssetId") ?? ""),
      destinationQuantity: String(formData.get("destinationQuantity") ?? ""),
      fee: nullableString(formData.get("fee")) ?? undefined,
      currency: baseCurrency,
      executedAt: String(formData.get("executedAt") ?? ""),
      note: nullableString(formData.get("note")) ?? undefined,
      auditReason: nullableString(formData.get("auditReason")) ?? undefined,
    }));
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateTransactionAction(
  previousState: PortfolioActionState = initialState,
  formData: FormData,
): Promise<PortfolioActionState> {
  void previousState;
  try {
    return await withPortfolioRevalidation(updateTransactionMutation({
      id: String(formData.get("id") ?? ""),
      basisMethod: nullableString(formData.get("basisMethod")) as BasisMethod | undefined,
      quantity: nullableString(formData.get("quantity")) ?? undefined,
      physicalGoldWeightTroyOunces: nullableString(formData.get("physicalGoldWeightTroyOunces")) ?? undefined,
      pricePerUnit: nullableString(formData.get("pricePerUnit")) ?? undefined,
      totalAmount: nullableString(formData.get("totalAmount")) ?? undefined,
      fee: nullableString(formData.get("fee")) ?? undefined,
      executedAt: String(formData.get("executedAt") ?? ""),
      note: nullableString(formData.get("note")) ?? undefined,
      auditReason: nullableString(formData.get("auditReason")) ?? undefined,
    }));
  } catch (error) {
    return toActionError(error);
  }
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
  revalidatePath("/performance");
  return result;
}
