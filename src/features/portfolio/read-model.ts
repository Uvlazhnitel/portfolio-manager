import { AssetType, TransactionType, type Prisma } from "@prisma/client";
import { calculateHoldings } from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { serializeDecimal, serializeNullableDecimal } from "@/lib/db/decimal";

type TransactionWithRelations = Awaited<ReturnType<PortfolioRepository["listTransactions"]>>[number];
type AssetRow = Awaited<ReturnType<PortfolioRepository["listAssets"]>>[number];
type AccountRow = Awaited<ReturnType<PortfolioRepository["listAccounts"]>>[number];

export type PortfolioHoldingRow = {
  assetId: string;
  accountId: string;
  assetName: string;
  symbol: string;
  accountName: string;
  quantity: string;
  currentValue: string | null;
  currentPrice: string | null;
  averageAcquisitionPrice: string | null;
  pnl: string | null;
  assetClass: string;
  assetType: string;
  portfolioWeight: string | null;
  quantityLabel: string;
};

export type PortfolioTransactionRow = {
  id: string;
  type: string;
  assetName: string;
  symbol: string;
  accountName: string;
  quantity: string;
  pricePerUnit: string | null;
  fee: string | null;
  currency: string;
  executedAt: string;
  note: string | null;
};

export type PortfolioReadModel = {
  assets: Array<{
    id: string;
    symbol: string;
    name: string;
    assetClass: string;
    assetType: string;
    currency: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    description: string | null;
  }>;
  holdings: PortfolioHoldingRow[];
  transactions: PortfolioTransactionRow[];
};

export async function getPortfolioReadModel(repository = new PortfolioRepository()): Promise<PortfolioReadModel> {
  const [assets, accounts, transactions] = await Promise.all([
    repository.listAssets(),
    repository.listAccounts(),
    repository.listTransactions(),
  ]);
  const holdings = buildHoldingRows(assets, accounts, transactions);

  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      currency: asset.currency,
    })),
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      description: account.description,
    })),
    holdings,
    transactions: transactions.map(serializeTransactionRow),
  };
}

function buildHoldingRows(
  assets: AssetRow[],
  accounts: AccountRow[],
  transactions: TransactionWithRelations[],
): PortfolioHoldingRow[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const holdings = calculateHoldings(transactions);
  const costBasisByHolding = calculateCostBasis(transactions);

  const rows = holdings.map((holding) => {
    const asset = assetsById.get(holding.assetId);
    const account = accountsById.get(holding.accountId);
    const costBasis = costBasisByHolding.get(holdingKey(holding.accountId, holding.assetId));
    const quantity = decimal(holding.quantity);
    const averageAcquisitionPrice =
      costBasis && quantity.greaterThan(ZERO) && costBasis.cost.greaterThan(ZERO)
        ? costBasis.cost.div(quantity).toFixed(2)
        : null;

    return {
      assetId: holding.assetId,
      accountId: holding.accountId,
      assetName: asset?.name ?? "Unknown asset",
      symbol: asset?.symbol ?? "UNKNOWN",
      accountName: account?.name ?? "Unknown account",
      quantity: holding.quantity,
      currentValue: null,
      currentPrice: null,
      averageAcquisitionPrice,
      pnl: null,
      assetClass: asset?.assetClass ?? "OTHER",
      assetType: asset?.assetType ?? "OTHER",
      portfolioWeight: null,
      quantityLabel: asset?.assetType === AssetType.PHYSICAL_GOLD ? `${holding.quantity} g` : holding.quantity,
    };
  });

  const totalAvailableValue = rows.reduce((sum, row) => {
    return row.currentValue ? sum.plus(row.currentValue) : sum;
  }, ZERO);

  return rows.map((row) => ({
    ...row,
    portfolioWeight:
      row.currentValue && totalAvailableValue.greaterThan(ZERO)
        ? decimal(row.currentValue).div(totalAvailableValue).mul(100).toFixed(2)
        : null,
  }));
}

function calculateCostBasis(transactions: TransactionWithRelations[]) {
  const sorted = [...transactions].sort((left, right) => left.executedAt.getTime() - right.executedAt.getTime());
  const costByHolding = new Map<string, { quantity: Prisma.Decimal; cost: Prisma.Decimal }>();

  for (const transaction of sorted) {
    const key = holdingKey(transaction.accountId, transaction.assetId);
    const current = costByHolding.get(key) ?? { quantity: ZERO, cost: ZERO };
    const quantity = transaction.quantity;

    if (transaction.type === TransactionType.INITIAL_BALANCE || transaction.type === TransactionType.BUY) {
      const addedCost = transaction.pricePerUnit ? quantity.mul(transaction.pricePerUnit) : ZERO;
      const fee = transaction.fee ?? ZERO;

      costByHolding.set(key, {
        quantity: current.quantity.plus(quantity),
        cost: current.cost.plus(addedCost).plus(fee),
      });
    }

    if (transaction.type === TransactionType.SELL) {
      const averageCost = current.quantity.greaterThan(ZERO) ? current.cost.div(current.quantity) : ZERO;
      const remainingQuantity = current.quantity.minus(quantity);
      const remainingCost = current.cost.minus(averageCost.mul(quantity));

      costByHolding.set(key, {
        quantity: remainingQuantity.greaterThan(ZERO) ? remainingQuantity : ZERO,
        cost: remainingCost.greaterThan(ZERO) ? remainingCost : ZERO,
      });
    }
  }

  return costByHolding;
}

export function serializeTransactionRow(transaction: TransactionWithRelations): PortfolioTransactionRow {
  return {
    id: transaction.id,
    type: transaction.type,
    assetName: transaction.asset.name,
    symbol: transaction.asset.symbol,
    accountName: transaction.account.name,
    quantity: serializeDecimal(transaction.quantity),
    pricePerUnit: serializeNullableDecimal(transaction.pricePerUnit),
    fee: serializeNullableDecimal(transaction.fee),
    currency: transaction.currency,
    executedAt: transaction.executedAt.toISOString(),
    note: transaction.note,
  };
}

export function holdingKey(accountId: string, assetId: string) {
  return `${accountId}:${assetId}`;
}
