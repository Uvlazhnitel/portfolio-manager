import {
  AccountType,
  AssetClass,
  AssetType,
  BasisMethod,
  TransactionType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

export const ETH_RECONCILIATION = {
  accountName: "Bybit",
  symbol: "ETH",
  quantity: "0.12102410",
  pricePerUnit: "2690.01380658",
  currency: "USD",
  executedAt: new Date("2026-08-27T00:00:00.000Z"),
  sourceNetQuantity: "0.12698289",
  unexplainedDifference: "0.00595879",
  sourceFile: "unifiedAccount_spotTradeHistory_180838295_20240601_20250531_0.csv",
  note:
    "Reconciled from Bybit spot trade CSV unifiedAccount_spotTradeHistory_180838295_20240601_20250531_0.csv. Net purchases after trading fees: 0.12698289 ETH; unexplained difference: 0.00595879 ETH, allocated at weighted-average cost. Approximation: 1 USDT = 1 USD.",
} as const;

export type EthReconciliationResult = {
  transactionId: string;
  changed: boolean;
  summary: {
    quantity: string;
    pricePerUnit: string;
    totalBasis: string;
    currency: string;
  };
};

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function reconcileEthOpeningBalance(db: PrismaClient): Promise<EthReconciliationResult> {
  return db.$transaction(async (transaction) => reconcileEthOpeningBalanceInTransaction(transaction));
}

async function reconcileEthOpeningBalanceInTransaction(db: DbClient): Promise<EthReconciliationResult> {
  const [account, asset] = await Promise.all([
    db.account.upsert({
      where: { name: ETH_RECONCILIATION.accountName },
      update: {},
      create: { name: ETH_RECONCILIATION.accountName, type: AccountType.EXCHANGE },
    }),
    db.asset.upsert({
      where: { symbol: ETH_RECONCILIATION.symbol },
      update: { externalId: "ethereum" },
      create: {
        symbol: ETH_RECONCILIATION.symbol,
        name: "Ethereum",
        assetClass: AssetClass.CRYPTO,
        assetType: AssetType.CRYPTO,
        currency: "ETH",
        externalId: "ethereum",
        metadata: { imageUrl: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png" },
      },
    }),
  ]);

  const ethTransactions = await db.transaction.findMany({
    where: { assetId: asset.id },
    include: { account: true },
    orderBy: [{ executedAt: "asc" }, { id: "asc" }],
  });
  const realTransactions = ethTransactions.filter((transaction) => !(
    transaction.type === TransactionType.INITIAL_BALANCE &&
    transaction.accountId === account.id &&
    transaction.transactionGroupId === null
  ));

  if (realTransactions.length > 0) {
    const summary = realTransactions
      .map((transaction) => `${transaction.executedAt.toISOString().slice(0, 10)} ${transaction.account.name} ${transaction.type} ${transaction.quantity.toString()} ETH`)
      .join("; ");
    throw new Error(`ETH reconciliation stopped because real ETH history exists: ${summary}`);
  }

  const existing = ethTransactions.filter((transaction) => transaction.accountId === account.id);
  if (existing.length === 1) {
    const current = existing[0];
    const desired = {
      quantity: ETH_RECONCILIATION.quantity,
      pricePerUnit: ETH_RECONCILIATION.pricePerUnit,
      basisMethod: BasisMethod.KNOWN_COST,
      currency: ETH_RECONCILIATION.currency,
      executedAt: ETH_RECONCILIATION.executedAt,
      note: ETH_RECONCILIATION.note,
    };
    const changed = !(
      current.quantity.equals(desired.quantity) &&
      current.pricePerUnit?.equals(desired.pricePerUnit) &&
      current.basisMethod === desired.basisMethod &&
      current.currency === desired.currency &&
      current.executedAt.getTime() === desired.executedAt.getTime() &&
      current.note === desired.note
    );
    const transaction = changed
      ? await db.transaction.update({ where: { id: current.id }, data: desired })
      : current;

    return reconciliationResult(transaction.id, changed);
  }

  await db.transaction.deleteMany({
    where: {
      assetId: asset.id,
      accountId: account.id,
      type: TransactionType.INITIAL_BALANCE,
      transactionGroupId: null,
    },
  });
  const transaction = await db.transaction.create({
    data: {
      accountId: account.id,
      assetId: asset.id,
      type: TransactionType.INITIAL_BALANCE,
      basisMethod: BasisMethod.KNOWN_COST,
      quantity: ETH_RECONCILIATION.quantity,
      pricePerUnit: ETH_RECONCILIATION.pricePerUnit,
      currency: ETH_RECONCILIATION.currency,
      executedAt: ETH_RECONCILIATION.executedAt,
      note: ETH_RECONCILIATION.note,
    },
  });

  return reconciliationResult(transaction.id, true);
}

function reconciliationResult(transactionId: string, changed: boolean): EthReconciliationResult {
  return {
    transactionId,
    changed,
    summary: {
      quantity: ETH_RECONCILIATION.quantity,
      pricePerUnit: ETH_RECONCILIATION.pricePerUnit,
      totalBasis: "325.55649993",
      currency: ETH_RECONCILIATION.currency,
    },
  };
}
