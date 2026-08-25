import {
  AssetType,
  Prisma,
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

export class PortfolioMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioMutationError";
  }
}

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

  try {
    await repository.createAccount({
      name: parsed.name,
      type: parsed.type,
      description: parsed.description || null,
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new PortfolioMutationError("Account name already exists.");
    throw error;
  }

  return { ok: true, message: "Account created." };
}

export async function createTransactionMutation(
  input: TransactionMutationInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = transactionMutationSchema.parse(input);
  await withSerializableRetry(db, async (transaction) => {
    const repository = new PortfolioRepository(transaction);
    const account = await repository.findAccount(parsed.accountId);
    if (!account) throw new PortfolioMutationError("Selected account does not exist.");

    const asset = await resolveAsset(parsed, transaction);
    const normalized = normalizeTransaction(parsed, asset.assetType);

    if (parsed.type === TransactionType.SELL && !parsed.allowOversell) {
      await assertEnoughQuantityForSell({
        db: transaction,
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

async function resolveAsset(parsed: z.infer<typeof transactionMutationSchema>, db: Prisma.TransactionClient) {
  if (parsed.assetMode === "new") {
    if (!parsed.newAsset) {
      throw new PortfolioMutationError("New asset details are required.");
    }

    const existing = await db.asset.findUnique({ where: { symbol: parsed.newAsset.symbol } });
    if (existing) {
      throw new PortfolioMutationError(`Asset symbol ${parsed.newAsset.symbol} already exists. Select the existing asset.`);
    }

    try {
      return await db.asset.create({
        data: {
          symbol: parsed.newAsset.symbol,
          name: parsed.newAsset.name,
          assetClass: parsed.newAsset.assetClass,
          assetType: parsed.newAsset.assetType,
          currency: parsed.newAsset.currency,
          externalId: parsed.newAsset.externalId || null,
          metadata: parsed.newAsset.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new PortfolioMutationError(`Asset symbol ${parsed.newAsset.symbol} already exists. Select the existing asset.`);
      }
      throw error;
    }
  }

  if (!parsed.assetId) {
    throw new PortfolioMutationError("Asset is required.");
  }

  const asset = await db.asset.findUnique({ where: { id: parsed.assetId } });

  if (!asset) {
    throw new PortfolioMutationError("Selected asset does not exist.");
  }

  return asset;
}

function normalizeTransaction(parsed: z.infer<typeof transactionMutationSchema>, assetType: AssetType) {
  const isPhysicalGold = assetType === AssetType.PHYSICAL_GOLD;
  const quantity = isPhysicalGold && parsed.physicalGoldWeightGrams ? parsed.physicalGoldWeightGrams : parsed.quantity;

  if (!quantity) {
    throw new PortfolioMutationError(isPhysicalGold ? "Weight grams is required." : "Quantity is required.");
  }

  let pricePerUnit = parsed.pricePerUnit ?? null;

  if (isPhysicalGold && parsed.totalPurchaseCost) {
    pricePerUnit = decimal(parsed.totalPurchaseCost).div(decimal(quantity)).toDecimalPlaces(8).toString();
  }

  if ((parsed.type === TransactionType.BUY || parsed.type === TransactionType.SELL) && !pricePerUnit) {
    throw new PortfolioMutationError("Price per unit is required for buy and sell transactions.");
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
  db: Prisma.TransactionClient;
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
    throw new PortfolioMutationError("Cannot sell more than the current account holding without override.");
  }
}

async function withSerializableRetry<T>(
  db: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < maxAttempts && isPrismaError(error, "P2034")) continue;
      throw error;
    }
  }
  throw new PortfolioMutationError("Transaction could not be saved due to a concurrent update. Please retry.");
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
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
