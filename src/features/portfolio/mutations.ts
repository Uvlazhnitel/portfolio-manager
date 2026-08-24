import {
  AssetType,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { calculateHoldings } from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { PortfolioRepository } from "@/features/portfolio/repository";
import {
  accountInputSchema,
  assetInputSchema,
  nonNegativeDecimalStringSchema,
  positiveDecimalStringSchema,
} from "@/features/portfolio/validation";
import { prisma } from "@/lib/db/client";

const implementedTransactionTypes = [
  TransactionType.INITIAL_BALANCE,
  TransactionType.BUY,
  TransactionType.SELL,
] as const;

export type PortfolioMutationResult = {
  ok: boolean;
  message: string;
};

export const transactionMutationSchema = z.object({
  type: z.enum(implementedTransactionTypes),
  accountId: z.string().min(1),
  assetMode: z.enum(["existing", "new"]).default("existing"),
  assetId: z.string().optional(),
  newAsset: assetInputSchema.optional(),
  quantity: positiveDecimalStringSchema.optional(),
  physicalGoldWeightGrams: positiveDecimalStringSchema.optional(),
  pricePerUnit: nonNegativeDecimalStringSchema.optional(),
  totalPurchaseCost: nonNegativeDecimalStringSchema.optional(),
  fee: nonNegativeDecimalStringSchema.optional(),
  currency: z.string().trim().min(3).max(12).default("EUR").transform((value) => value.toUpperCase()),
  executedAt: z.coerce.date(),
  note: z.string().trim().optional(),
  allowOversell: z.boolean().default(false),
});

export type TransactionMutationInput = z.input<typeof transactionMutationSchema>;

export async function createAccountMutation(
  input: z.input<typeof accountInputSchema>,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = accountInputSchema.parse(input);
  const repository = new PortfolioRepository(db);

  await repository.createAccount({
    name: parsed.name,
    type: parsed.type,
    description: parsed.description || null,
  });

  return { ok: true, message: "Account created." };
}

export async function createTransactionMutation(
  input: TransactionMutationInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = transactionMutationSchema.parse(input);
  const repository = new PortfolioRepository(db);
  const asset = await resolveAsset(parsed, db);
  const account = await repository.findAccount(parsed.accountId);

  if (!account) {
    throw new Error("Selected account does not exist.");
  }

  const normalized = normalizeTransaction(parsed, asset.assetType);

  if (parsed.type === TransactionType.SELL && !parsed.allowOversell) {
    await assertEnoughQuantityForSell({
      db,
      accountId: parsed.accountId,
      assetId: asset.id,
      quantity: normalized.quantity,
    });
  }

  await repository.createTransaction({
    assetId: asset.id,
    accountId: parsed.accountId,
    type: parsed.type,
    quantity: normalized.quantity,
    pricePerUnit: normalized.pricePerUnit,
    fee: normalized.fee,
    currency: parsed.currency,
    executedAt: parsed.executedAt,
    note: parsed.note || null,
  });

  return { ok: true, message: "Transaction saved." };
}

export async function deleteTransactionMutation(
  id: string,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  if (!id) {
    throw new Error("Transaction id is required.");
  }

  await new PortfolioRepository(db).deleteTransaction(id);
  return { ok: true, message: "Transaction deleted." };
}

async function resolveAsset(parsed: z.infer<typeof transactionMutationSchema>, db: PrismaClient) {
  if (parsed.assetMode === "new") {
    if (!parsed.newAsset) {
      throw new Error("New asset details are required.");
    }

    return db.asset.upsert({
      where: { symbol: parsed.newAsset.symbol },
      update: {
        name: parsed.newAsset.name,
        assetClass: parsed.newAsset.assetClass,
        assetType: parsed.newAsset.assetType,
        currency: parsed.newAsset.currency,
        externalId: parsed.newAsset.externalId || null,
      },
      create: {
        symbol: parsed.newAsset.symbol,
        name: parsed.newAsset.name,
        assetClass: parsed.newAsset.assetClass,
        assetType: parsed.newAsset.assetType,
        currency: parsed.newAsset.currency,
        externalId: parsed.newAsset.externalId || null,
      },
    });
  }

  if (!parsed.assetId) {
    throw new Error("Asset is required.");
  }

  const asset = await db.asset.findUnique({ where: { id: parsed.assetId } });

  if (!asset) {
    throw new Error("Selected asset does not exist.");
  }

  return asset;
}

function normalizeTransaction(parsed: z.infer<typeof transactionMutationSchema>, assetType: AssetType) {
  const isPhysicalGold = assetType === AssetType.PHYSICAL_GOLD;
  const quantity = isPhysicalGold && parsed.physicalGoldWeightGrams ? parsed.physicalGoldWeightGrams : parsed.quantity;

  if (!quantity) {
    throw new Error(isPhysicalGold ? "Weight grams is required." : "Quantity is required.");
  }

  let pricePerUnit = parsed.pricePerUnit ?? null;

  if (isPhysicalGold && parsed.totalPurchaseCost) {
    pricePerUnit = decimal(parsed.totalPurchaseCost).div(decimal(quantity)).toString();
  }

  if ((parsed.type === TransactionType.BUY || parsed.type === TransactionType.SELL) && !pricePerUnit) {
    throw new Error("Price per unit is required for buy and sell transactions.");
  }

  return {
    quantity,
    pricePerUnit,
    fee: parsed.fee ?? null,
  };
}

async function assertEnoughQuantityForSell({
  db,
  accountId,
  assetId,
  quantity,
}: {
  db: PrismaClient;
  accountId: string;
  assetId: string;
  quantity: string;
}) {
  const transactions = await db.transaction.findMany({
    where: { accountId, assetId },
    orderBy: { executedAt: "asc" },
  });
  const currentHolding = calculateHoldings(transactions).find(
    (holding) => holding.accountId === accountId && holding.assetId === assetId,
  );
  const currentQuantity = currentHolding ? decimal(currentHolding.quantity) : ZERO;

  if (decimal(quantity).greaterThan(currentQuantity)) {
    throw new Error("Cannot sell more than the current account holding without override.");
  }
}

export function createPhysicalGoldInitialBalanceInput(input: {
  accountId: string;
  physicalGoldAssetId: string;
  weightGrams: string;
  totalPurchaseCost?: string;
  executedAt: Date;
  note?: string;
}): TransactionMutationInput {
  return {
    type: TransactionType.INITIAL_BALANCE,
    accountId: input.accountId,
    assetMode: "existing",
    assetId: input.physicalGoldAssetId,
    physicalGoldWeightGrams: input.weightGrams,
    totalPurchaseCost: input.totalPurchaseCost,
    currency: "EUR",
    executedAt: input.executedAt,
    note: input.note,
  };
}
