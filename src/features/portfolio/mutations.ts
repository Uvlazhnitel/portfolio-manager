import {
  AssetClass,
  AssetQuoteProvider,
  AssetType,
  MarketPriceUnit,
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
  assetQuoteLinkSchema,
  assetInputSchema,
  nonNegativeDecimalStringSchema,
  positiveDecimalStringSchema,
} from "@/features/portfolio/validation";
import { prisma } from "@/lib/db/client";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import {
  formatPhysicalGoldQuantity,
  goldPricePerGram,
  troyOuncesToGrams,
} from "@/features/market-data/gold";

const implementedTransactionTypes = [
  TransactionType.INITIAL_BALANCE,
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DEPOSIT,
  TransactionType.WITHDRAWAL,
  TransactionType.TRANSFER_IN,
  TransactionType.TRANSFER_OUT,
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
  physicalGoldWeightTroyOunces: positiveDecimalStringSchema.optional(),
  pricePerUnit: nonNegativeDecimalStringSchema.optional(),
  totalAmount: nonNegativeDecimalStringSchema.optional(),
  totalPurchaseCost: nonNegativeDecimalStringSchema.optional(),
  fee: nonNegativeDecimalStringSchema.optional(),
  currency: z.string().trim().min(3).max(12).default(DEFAULT_BASE_CURRENCY).transform((value) => value.toUpperCase()),
  executedAt: z.coerce.date(),
  note: z.string().trim().optional(),
});

export type TransactionMutationInput = z.input<typeof transactionMutationSchema>;

export const updateTransactionSchema = transactionMutationSchema.pick({
  quantity: true,
  physicalGoldWeightTroyOunces: true,
  pricePerUnit: true,
  totalAmount: true,
  fee: true,
  executedAt: true,
  note: true,
}).extend({ id: z.string().min(1) });

export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;

export const transferMutationSchema = z.object({
  assetId: z.string().min(1),
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  quantity: positiveDecimalStringSchema.optional(),
  physicalGoldWeightTroyOunces: positiveDecimalStringSchema.optional(),
  currency: z.string().trim().min(3).max(12).default(DEFAULT_BASE_CURRENCY).transform((value) => value.toUpperCase()),
  executedAt: z.coerce.date(),
  note: z.string().trim().optional(),
});

export type TransferMutationInput = z.input<typeof transferMutationSchema>;

export type AssetQuoteLinkInput = z.input<typeof assetQuoteLinkSchema>;

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

export async function linkAssetQuoteMutation(
  input: AssetQuoteLinkInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = assetQuoteLinkSchema.parse(input);
  await db.$transaction(async (transaction) => {
    const asset = await transaction.asset.findUnique({ where: { id: parsed.assetId } });
    if (!asset) throw new PortfolioMutationError("Selected asset does not exist.");
    if (asset.assetClass !== AssetClass.ETF || asset.assetType !== AssetType.ETF) {
      throw new PortfolioMutationError("Automatic exchange quotes are only available for ETF assets.");
    }
    await transaction.asset.update({
      where: { id: asset.id },
      data: {
        currency: parsed.currency,
        quoteProvider: parsed.quoteProvider,
        quoteSymbol: parsed.quoteSymbol,
        quoteMicCode: parsed.quoteMicCode,
      },
    });
    await transaction.cachedMarketPrice.deleteMany({ where: { assetId: asset.id } });
  });
  return { ok: true, message: "ETF market quote linked." };
}

export async function createTransactionMutation(
  input: TransactionMutationInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = transactionMutationSchema.parse(input);
  const saved = await withSerializableRetry(db, async (transaction) => {
    const repository = new PortfolioRepository(transaction);
    const account = await repository.findAccount(parsed.accountId);
    if (!account) throw new PortfolioMutationError("Selected account does not exist.");

    const asset = await resolveAsset(parsed, transaction);
    if ((parsed.type === TransactionType.DEPOSIT || parsed.type === TransactionType.WITHDRAWAL) && asset.assetClass !== AssetClass.CASH) {
      throw new PortfolioMutationError("Deposits and withdrawals are only available for CASH assets.");
    }
    const normalized = normalizeTransaction(parsed, asset);

    if (parsed.type === TransactionType.SELL || parsed.type === TransactionType.WITHDRAWAL || parsed.type === TransactionType.TRANSFER_OUT) {
      await assertEnoughQuantityForSell({
        db: transaction,
        accountId: parsed.accountId,
        assetId: asset.id,
        quantity: normalized.quantity,
        executedAt: parsed.executedAt,
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

    return {
      accountName: account.name,
      quantityLabel: asset.assetType === AssetType.PHYSICAL_GOLD
        ? formatPhysicalGoldQuantity(normalized.quantity)
        : `${normalized.quantity} ${asset.symbol}`,
    };
  });

  return {
    ok: true,
    message: parsed.type === TransactionType.INITIAL_BALANCE
      ? `Added ${saved.quantityLabel} to ${saved.accountName}.`
      : "Transaction saved.",
  };
}

export async function createTransferMutation(
  input: TransferMutationInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = transferMutationSchema.parse(input);
  if (parsed.fromAccountId === parsed.toAccountId) {
    throw new PortfolioMutationError("Transfer source and destination accounts must be different.");
  }

  const saved = await withSerializableRetry(db, async (transaction) => {
    const repository = new PortfolioRepository(transaction);
    const [fromAccount, toAccount, asset] = await Promise.all([
      repository.findAccount(parsed.fromAccountId),
      repository.findAccount(parsed.toAccountId),
      repository.findAsset(parsed.assetId),
    ]);
    if (!fromAccount) throw new PortfolioMutationError("Source account does not exist.");
    if (!toAccount) throw new PortfolioMutationError("Destination account does not exist.");
    if (!asset) throw new PortfolioMutationError("Selected asset does not exist.");

    const normalized = normalizeTransfer(parsed, asset.assetType);
    await assertEnoughQuantityForSell({
      db: transaction,
      accountId: fromAccount.id,
      assetId: asset.id,
      quantity: normalized.quantity,
      executedAt: parsed.executedAt,
    });

    await transaction.transaction.createMany({
      data: [
        {
          assetId: asset.id,
          accountId: fromAccount.id,
          type: TransactionType.TRANSFER_OUT,
          quantity: normalized.quantity,
          pricePerUnit: null,
          fee: null,
          currency: parsed.currency,
          executedAt: parsed.executedAt,
          note: parsed.note || null,
        },
        {
          assetId: asset.id,
          accountId: toAccount.id,
          type: TransactionType.TRANSFER_IN,
          quantity: normalized.quantity,
          pricePerUnit: null,
          fee: null,
          currency: parsed.currency,
          executedAt: parsed.executedAt,
          note: parsed.note || null,
        },
      ],
    });

    return {
      fromAccountName: fromAccount.name,
      toAccountName: toAccount.name,
      quantityLabel: asset.assetType === AssetType.PHYSICAL_GOLD
        ? formatPhysicalGoldQuantity(normalized.quantity)
        : `${normalized.quantity} ${asset.symbol}`,
    };
  });

  return {
    ok: true,
    message: `Transferred ${saved.quantityLabel} from ${saved.fromAccountName} to ${saved.toAccountName}.`,
  };
}

export async function deleteTransactionMutation(
  id: string,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  if (!id) {
    throw new Error("Transaction id is required.");
  }

  await withSerializableRetry(db, async (transaction) => {
    const target = await transaction.transaction.findUnique({ where: { id } });
    if (!target) throw new PortfolioMutationError("Transaction was not found.");

    const remaining = await transaction.transaction.findMany({
      where: { accountId: target.accountId, assetId: target.assetId, id: { not: id } },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
    assertNonNegativeChronology(remaining);
    await transaction.transaction.delete({ where: { id } });
  });
  return { ok: true, message: "Transaction deleted." };
}

export async function updateTransactionMutation(
  input: UpdateTransactionInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = updateTransactionSchema.parse(input);

  await withSerializableRetry(db, async (transaction) => {
    const target = await transaction.transaction.findUnique({
      where: { id: parsed.id },
      include: { asset: true },
    });
    if (!target) throw new PortfolioMutationError("Transaction was not found.");
    if (target.type === TransactionType.TRANSFER_IN || target.type === TransactionType.TRANSFER_OUT) {
      throw new PortfolioMutationError("Transfer rows cannot be edited individually.");
    }

    const normalized = normalizeTransaction({
      ...parsed,
      type: target.type,
      accountId: target.accountId,
      assetMode: "existing",
      assetId: target.assetId,
      currency: target.currency,
    }, target.asset);

    await transaction.transaction.update({
      where: { id: target.id },
      data: {
        quantity: normalized.quantity,
        pricePerUnit: normalized.pricePerUnit,
        fee: normalized.fee,
        executedAt: parsed.executedAt,
        note: parsed.note || null,
      },
    });
    const chronology = await transaction.transaction.findMany({
      where: { accountId: target.accountId, assetId: target.assetId },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
    assertNonNegativeChronology(chronology);
  });

  return { ok: true, message: "Transaction updated." };
}

async function resolveAsset(parsed: z.infer<typeof transactionMutationSchema>, db: Prisma.TransactionClient) {
  if (parsed.assetMode === "new") {
    if (!parsed.newAsset) {
      throw new PortfolioMutationError("New asset details are required.");
    }

    const existingByExternalId = parsed.newAsset.externalId
      ? await db.asset.findFirst({ where: { externalId: parsed.newAsset.externalId } })
      : null;
    if (existingByExternalId) return existingByExternalId;

    const existingByQuoteIdentity = parsed.newAsset.quoteProvider && parsed.newAsset.quoteSymbol
      ? await db.asset.findFirst({
          where: quoteIdentityWhere({
            quoteProvider: parsed.newAsset.quoteProvider,
            quoteSymbol: parsed.newAsset.quoteSymbol,
            quoteMicCode: parsed.newAsset.quoteMicCode,
          }),
        })
      : null;
    if (existingByQuoteIdentity) return existingByQuoteIdentity;

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
          quoteProvider: parsed.newAsset.quoteProvider || null,
          quoteSymbol: parsed.newAsset.quoteSymbol || null,
          quoteMicCode: parsed.newAsset.quoteMicCode || null,
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

function quoteIdentityWhere(asset: {
  quoteProvider: AssetQuoteProvider;
  quoteSymbol: string;
  quoteMicCode?: string | null;
}) {
  return asset.quoteProvider === AssetQuoteProvider.ALPHA_VANTAGE
    ? { quoteProvider: asset.quoteProvider, quoteSymbol: asset.quoteSymbol }
    : { quoteProvider: asset.quoteProvider, quoteSymbol: asset.quoteSymbol, quoteMicCode: asset.quoteMicCode ?? null };
}

function normalizeTransaction(parsed: z.infer<typeof transactionMutationSchema>, asset: { assetType: AssetType; currency: string }) {
  const assetType = asset.assetType;
  const isPhysicalGold = assetType === AssetType.PHYSICAL_GOLD;
  const inputQuantity = isPhysicalGold
    ? parsed.physicalGoldWeightTroyOunces
    : parsed.quantity;

  if (!inputQuantity) {
    throw new PortfolioMutationError(isPhysicalGold ? "Weight in troy ounces is required." : "Quantity is required.");
  }

  const quantity = isPhysicalGold
    ? troyOuncesToGrams(inputQuantity).toDecimalPlaces(18).toString()
    : inputQuantity;

  let pricePerUnit = parsed.pricePerUnit ?? null;
  if (isPhysicalGold && pricePerUnit) {
    pricePerUnit = goldPricePerGram(pricePerUnit, MarketPriceUnit.TROY_OUNCE)
      .toDecimalPlaces(8)
      .toString();
  }
  const totalAmount = parsed.totalAmount ?? parsed.totalPurchaseCost ?? null;

  if (totalAmount) {
    const derivedPrice = decimal(totalAmount).div(decimal(quantity)).toDecimalPlaces(8).toString();
    if (pricePerUnit) {
      const calculatedTotal = decimal(pricePerUnit).mul(quantity).toDecimalPlaces(2);
      const suppliedTotal = decimal(totalAmount).toDecimalPlaces(2);
      if (calculatedTotal.minus(suppliedTotal).abs().greaterThan("0.01")) {
        throw new PortfolioMutationError("Price per unit and total amount do not match within one cent.");
      }
    } else {
      pricePerUnit = derivedPrice;
    }
  }

  if ((parsed.type === TransactionType.BUY || parsed.type === TransactionType.SELL) && !pricePerUnit) {
    throw new PortfolioMutationError("Enter either price per unit or the total amount for this transaction.");
  }

  if ((parsed.type === TransactionType.DEPOSIT || parsed.type === TransactionType.WITHDRAWAL) && !pricePerUnit) {
    if (asset.currency.toUpperCase() !== parsed.currency.toUpperCase()) {
      throw new PortfolioMutationError("Enter either price per unit or the total amount for this cashflow.");
    }
    pricePerUnit = "1";
  }

  if ((parsed.type === TransactionType.TRANSFER_IN || parsed.type === TransactionType.TRANSFER_OUT) && (pricePerUnit || parsed.fee)) {
    throw new PortfolioMutationError("Transfers do not store price or fee. Use Buy or Sell for trades.");
  }

  return {
    quantity,
    pricePerUnit,
    fee: parsed.fee ?? null,
  };
}

function normalizeTransfer(parsed: z.infer<typeof transferMutationSchema>, assetType: AssetType) {
  const isPhysicalGold = assetType === AssetType.PHYSICAL_GOLD;
  const inputQuantity = isPhysicalGold
    ? parsed.physicalGoldWeightTroyOunces
    : parsed.quantity;

  if (!inputQuantity) {
    throw new PortfolioMutationError(isPhysicalGold ? "Weight in troy ounces is required." : "Quantity is required.");
  }

  return {
    quantity: isPhysicalGold
      ? troyOuncesToGrams(inputQuantity).toDecimalPlaces(18).toString()
      : inputQuantity,
  };
}

async function assertEnoughQuantityForSell({
  db,
  accountId,
  assetId,
  quantity,
  executedAt,
}: {
  db: Prisma.TransactionClient;
  accountId: string;
  assetId: string;
  quantity: string;
  executedAt: Date;
}) {
  const transactions = await db.transaction.findMany({
    where: { accountId, assetId, executedAt: { lte: executedAt } },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
  });
  const currentHolding = calculateHoldings(transactions).find(
    (holding) => holding.accountId === accountId && holding.assetId === assetId,
  );
  const currentQuantity = currentHolding ? decimal(currentHolding.quantity) : ZERO;

  if (decimal(quantity).greaterThan(currentQuantity)) {
    throw new PortfolioMutationError("Add a starting balance or earlier buy first. You cannot sell more than was held in this account on the sale date.");
  }
}

function assertNonNegativeChronology(transactions: Array<{ type: TransactionType; quantity: Prisma.Decimal }>) {
  let quantity = ZERO;
  for (const transaction of transactions) {
    const decreases = transaction.type === TransactionType.SELL ||
      transaction.type === TransactionType.WITHDRAWAL ||
      transaction.type === TransactionType.TRANSFER_OUT;
    quantity = decreases ? quantity.minus(transaction.quantity) : quantity.plus(transaction.quantity);
    if (quantity.lessThan(ZERO)) {
      throw new PortfolioMutationError("This transaction is required by a later sale or withdrawal. Delete or adjust the later transaction first.");
    }
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
  weightTroyOunces: string;
  totalPurchaseCost?: string;
  executedAt: Date;
  note?: string;
}): TransactionMutationInput {
  return {
    type: TransactionType.INITIAL_BALANCE,
    accountId: input.accountId,
    assetMode: "existing",
    assetId: input.physicalGoldAssetId,
    physicalGoldWeightTroyOunces: input.weightTroyOunces,
    totalPurchaseCost: input.totalPurchaseCost,
    currency: DEFAULT_BASE_CURRENCY,
    executedAt: input.executedAt,
    note: input.note,
  };
}
