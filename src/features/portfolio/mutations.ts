import {
  AssetClass,
  AssetQuoteProvider,
  AssetType,
  MarketPriceUnit,
  Prisma,
  TransactionGroupKind,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { calculateHoldingCostBasis, calculateHoldings, calculatePortfolio } from "@/features/portfolio-engine";
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

export const updateTransferSchema = transferMutationSchema.extend({ groupId: z.string().min(1) });
export type UpdateTransferInput = z.input<typeof updateTransferSchema>;

export const tradeMutationSchema = z.object({
  sourceAccountId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  sourceQuantity: positiveDecimalStringSchema,
  destinationAccountId: z.string().min(1),
  destinationAssetId: z.string().min(1),
  destinationQuantity: positiveDecimalStringSchema,
  fee: nonNegativeDecimalStringSchema.optional(),
  currency: z.string().trim().min(3).max(12).default(DEFAULT_BASE_CURRENCY).transform((value) => value.toUpperCase()),
  executedAt: z.coerce.date(),
  note: z.string().trim().optional(),
});
export type TradeMutationInput = z.input<typeof tradeMutationSchema>;
export const updateTradeSchema = tradeMutationSchema.extend({ groupId: z.string().min(1) });
export type UpdateTradeInput = z.input<typeof updateTradeSchema>;

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

    if (parsed.type === TransactionType.SELL || parsed.type === TransactionType.WITHDRAWAL) {
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

    const group = await transaction.transactionGroup.create({ data: { kind: TransactionGroupKind.TRANSFER } });
    await transaction.transaction.createMany({
      data: [
        {
          transactionGroupId: group.id,
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
          transactionGroupId: group.id,
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
    await assertAffectedChronologies(transaction, [
      { accountId: fromAccount.id, assetId: asset.id },
      { accountId: toAccount.id, assetId: asset.id },
    ]);

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

export async function createTradeMutation(
  input: TradeMutationInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = tradeMutationSchema.parse(input);
  validateTradeIdentity(parsed);

  const saved = await withSerializableRetry(db, async (transaction) => {
    const [sourceAccount, destinationAccount, sourceAsset, destinationAsset] = await Promise.all([
      transaction.account.findUnique({ where: { id: parsed.sourceAccountId } }),
      transaction.account.findUnique({ where: { id: parsed.destinationAccountId } }),
      transaction.asset.findUnique({ where: { id: parsed.sourceAssetId } }),
      transaction.asset.findUnique({ where: { id: parsed.destinationAssetId } }),
    ]);
    if (!sourceAccount) throw new PortfolioMutationError("Source account does not exist.");
    if (!destinationAccount) throw new PortfolioMutationError("Destination account does not exist.");
    if (!sourceAsset) throw new PortfolioMutationError("Source asset does not exist.");
    if (!destinationAsset) throw new PortfolioMutationError("Destination asset does not exist.");

    await assertEnoughQuantityForSell({
      db: transaction,
      accountId: sourceAccount.id,
      assetId: sourceAsset.id,
      quantity: parsed.sourceQuantity,
      executedAt: parsed.executedAt,
    });
    const sourcePrice = await sourceAverageAcquisitionPrice({
      db: transaction,
      accountId: sourceAccount.id,
      asset: sourceAsset,
      executedAt: parsed.executedAt,
      baseCurrency: parsed.currency,
    });
    const carriedCost = decimal(sourcePrice).mul(parsed.sourceQuantity);
    const destinationPrice = carriedCost.div(parsed.destinationQuantity).toDecimalPlaces(8).toString();

    const group = await transaction.transactionGroup.create({ data: { kind: TransactionGroupKind.TRADE } });
    await transaction.transaction.createMany({ data: [
      {
        transactionGroupId: group.id,
        assetId: sourceAsset.id,
        accountId: sourceAccount.id,
        type: TransactionType.SELL,
        quantity: parsed.sourceQuantity,
        pricePerUnit: decimal(sourcePrice).toDecimalPlaces(8).toString(),
        fee: null,
        currency: parsed.currency,
        executedAt: parsed.executedAt,
        note: parsed.note || null,
      },
      {
        transactionGroupId: group.id,
        assetId: destinationAsset.id,
        accountId: destinationAccount.id,
        type: TransactionType.BUY,
        quantity: parsed.destinationQuantity,
        pricePerUnit: destinationPrice,
        fee: parsed.fee ?? null,
        currency: parsed.currency,
        executedAt: parsed.executedAt,
        note: parsed.note || null,
      },
    ] });
    await assertAffectedChronologies(transaction, [
      { accountId: sourceAccount.id, assetId: sourceAsset.id },
      { accountId: destinationAccount.id, assetId: destinationAsset.id },
    ]);

    return {
      source: `${parsed.sourceQuantity} ${sourceAsset.symbol}`,
      destination: `${parsed.destinationQuantity} ${destinationAsset.symbol}`,
    };
  });

  return { ok: true, message: `Traded ${saved.source} for ${saved.destination}.` };
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
    if (target.transactionGroupId) throw new PortfolioMutationError("Grouped operations must be deleted as one operation.");
    if (target.type === TransactionType.TRANSFER_IN || target.type === TransactionType.TRANSFER_OUT) {
      throw new PortfolioMutationError("Legacy ungrouped transfer rows are read-only.");
    }

    const remaining = await transaction.transaction.findMany({
      where: { accountId: target.accountId, assetId: target.assetId, id: { not: id } },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
    assertNonNegativeChronology(remaining);
    await transaction.transaction.delete({ where: { id } });
  });
  return { ok: true, message: "Transaction deleted." };
}

export async function deleteTransactionGroupMutation(
  groupId: string,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  if (!groupId) throw new Error("Transaction group id is required.");
  await withSerializableRetry(db, async (transaction) => {
    const group = await transaction.transactionGroup.findUnique({
      where: { id: groupId },
      include: { transactions: true },
    });
    if (!group) throw new PortfolioMutationError("Transaction group was not found.");
    const affected = group.transactions.map((leg) => ({ accountId: leg.accountId, assetId: leg.assetId }));
    await transaction.transactionGroup.delete({ where: { id: group.id } });
    await assertAffectedChronologies(transaction, affected);
  });
  return { ok: true, message: "Operation deleted." };
}

export async function updateTransferMutation(
  input: UpdateTransferInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = updateTransferSchema.parse(input);
  if (parsed.fromAccountId === parsed.toAccountId) {
    throw new PortfolioMutationError("Transfer source and destination accounts must be different.");
  }
  await withSerializableRetry(db, async (transaction) => {
    const group = await requireGroup(transaction, parsed.groupId, TransactionGroupKind.TRANSFER);
    const [fromAccount, toAccount, asset] = await Promise.all([
      transaction.account.findUnique({ where: { id: parsed.fromAccountId } }),
      transaction.account.findUnique({ where: { id: parsed.toAccountId } }),
      transaction.asset.findUnique({ where: { id: parsed.assetId } }),
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
      excludedGroupId: group.id,
    });
    const outgoing = group.transactions.find((leg) => leg.type === TransactionType.TRANSFER_OUT);
    const incoming = group.transactions.find((leg) => leg.type === TransactionType.TRANSFER_IN);
    if (!outgoing || !incoming) throw new PortfolioMutationError("Transfer group is incomplete.");
    const shared = { assetId: asset.id, quantity: normalized.quantity, currency: parsed.currency, executedAt: parsed.executedAt, note: parsed.note || null };
    await transaction.transaction.update({ where: { id: outgoing.id }, data: { ...shared, accountId: fromAccount.id } });
    await transaction.transaction.update({ where: { id: incoming.id }, data: { ...shared, accountId: toAccount.id } });
    await assertAffectedChronologies(transaction, [
      ...group.transactions.map((leg) => ({ accountId: leg.accountId, assetId: leg.assetId })),
      { accountId: fromAccount.id, assetId: asset.id },
      { accountId: toAccount.id, assetId: asset.id },
    ]);
  });
  return { ok: true, message: "Transfer updated." };
}

export async function updateTradeMutation(
  input: UpdateTradeInput,
  db: PrismaClient = prisma,
): Promise<PortfolioMutationResult> {
  const parsed = updateTradeSchema.parse(input);
  validateTradeIdentity(parsed);
  await withSerializableRetry(db, async (transaction) => {
    const group = await requireGroup(transaction, parsed.groupId, TransactionGroupKind.TRADE);
    const [sourceAccount, destinationAccount, sourceAsset, destinationAsset] = await Promise.all([
      transaction.account.findUnique({ where: { id: parsed.sourceAccountId } }),
      transaction.account.findUnique({ where: { id: parsed.destinationAccountId } }),
      transaction.asset.findUnique({ where: { id: parsed.sourceAssetId } }),
      transaction.asset.findUnique({ where: { id: parsed.destinationAssetId } }),
    ]);
    if (!sourceAccount) throw new PortfolioMutationError("Source account does not exist.");
    if (!destinationAccount) throw new PortfolioMutationError("Destination account does not exist.");
    if (!sourceAsset) throw new PortfolioMutationError("Source asset does not exist.");
    if (!destinationAsset) throw new PortfolioMutationError("Destination asset does not exist.");
    await assertEnoughQuantityForSell({ db: transaction, accountId: sourceAccount.id, assetId: sourceAsset.id, quantity: parsed.sourceQuantity, executedAt: parsed.executedAt, excludedGroupId: group.id });
    const sourcePrice = await sourceAverageAcquisitionPrice({ db: transaction, accountId: sourceAccount.id, asset: sourceAsset, executedAt: parsed.executedAt, excludedGroupId: group.id, baseCurrency: parsed.currency });
    const destinationPrice = decimal(sourcePrice).mul(parsed.sourceQuantity).div(parsed.destinationQuantity).toDecimalPlaces(8).toString();
    const sell = group.transactions.find((leg) => leg.type === TransactionType.SELL);
    const buy = group.transactions.find((leg) => leg.type === TransactionType.BUY);
    if (!sell || !buy) throw new PortfolioMutationError("Trade group is incomplete.");
    const shared = { currency: parsed.currency, executedAt: parsed.executedAt, note: parsed.note || null };
    await transaction.transaction.update({ where: { id: sell.id }, data: { ...shared, accountId: sourceAccount.id, assetId: sourceAsset.id, quantity: parsed.sourceQuantity, pricePerUnit: decimal(sourcePrice).toDecimalPlaces(8).toString(), fee: null } });
    await transaction.transaction.update({ where: { id: buy.id }, data: { ...shared, accountId: destinationAccount.id, assetId: destinationAsset.id, quantity: parsed.destinationQuantity, pricePerUnit: destinationPrice, fee: parsed.fee ?? null } });
    await assertAffectedChronologies(transaction, [
      ...group.transactions.map((leg) => ({ accountId: leg.accountId, assetId: leg.assetId })),
      { accountId: sourceAccount.id, assetId: sourceAsset.id },
      { accountId: destinationAccount.id, assetId: destinationAsset.id },
    ]);
  });
  return { ok: true, message: "Trade updated." };
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
    if (target.transactionGroupId) throw new PortfolioMutationError("Grouped operations must be edited as one operation.");
    if (target.type === TransactionType.TRANSFER_IN || target.type === TransactionType.TRANSFER_OUT) throw new PortfolioMutationError("Legacy ungrouped transfer rows are read-only.");

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
  excludedGroupId,
}: {
  db: Prisma.TransactionClient;
  accountId: string;
  assetId: string;
  quantity: string;
  executedAt: Date;
  excludedGroupId?: string;
}) {
  const transactions = await db.transaction.findMany({
    where: {
      accountId,
      assetId,
      executedAt: { lte: executedAt },
      ...(excludedGroupId ? { OR: [{ transactionGroupId: null }, { transactionGroupId: { not: excludedGroupId } }] } : {}),
    },
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

function validateTradeIdentity(input: { sourceAssetId: string; destinationAssetId: string }) {
  if (input.sourceAssetId === input.destinationAssetId) {
    throw new PortfolioMutationError("Trade source and destination assets must be different.");
  }
}

async function requireGroup(
  db: Prisma.TransactionClient,
  groupId: string,
  kind: TransactionGroupKind,
) {
  const group = await db.transactionGroup.findUnique({
    where: { id: groupId },
    include: { transactions: true },
  });
  if (!group || group.kind !== kind) throw new PortfolioMutationError(`${kind === TransactionGroupKind.TRADE ? "Trade" : "Transfer"} group was not found.`);
  if (group.transactions.length !== 2) throw new PortfolioMutationError("Transaction group is incomplete.");
  return group;
}

async function sourceAverageAcquisitionPrice({
  db,
  accountId,
  asset,
  executedAt,
  excludedGroupId,
  baseCurrency,
}: {
  db: Prisma.TransactionClient;
  accountId: string;
  asset: Prisma.AssetGetPayload<Record<string, never>>;
  executedAt: Date;
  excludedGroupId?: string;
  baseCurrency: string;
}) {
  const transactions = await db.transaction.findMany({
    where: {
      assetId: asset.id,
      executedAt: { lte: executedAt },
      ...(excludedGroupId ? { OR: [{ transactionGroupId: null }, { transactionGroupId: { not: excludedGroupId } }] } : {}),
    },
    include: { transactionGroup: true },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
  });
  const portfolio = calculatePortfolio({ assets: [asset], transactions, marketPrices: {} });
  const basis = calculateHoldingCostBasis({ portfolio, assets: [asset], transactions, baseCurrency })
    .find((row) => row.accountId === accountId && row.assetId === asset.id);
  if (!basis || basis.status !== "AVAILABLE" || !basis.averageAcquisitionPrice) {
    throw new PortfolioMutationError("Source cost basis is unavailable. Fix the earlier acquisition data before recording this trade.");
  }
  return basis.averageAcquisitionPrice;
}

async function assertAffectedChronologies(
  db: Prisma.TransactionClient,
  affected: Array<{ accountId: string; assetId: string }>,
) {
  const keys = new Map(affected.map((item) => [`${item.accountId}:${item.assetId}`, item]));
  for (const { accountId, assetId } of keys.values()) {
    const chronology = await db.transaction.findMany({
      where: { accountId, assetId },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }],
    });
    assertNonNegativeChronology(chronology);
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
