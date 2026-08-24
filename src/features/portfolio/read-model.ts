import { AssetType, TransactionType, type Prisma } from "@prisma/client";
import { calculatePortfolio } from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
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
  priceSource: string | null;
  priceTimestamp: string | null;
  isPriceStale: boolean;
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
  valuation: {
    totalValue: string;
    currency: string;
    isPartial: boolean;
    lastUpdated: string | null;
    hasStalePrices: boolean;
    warning: string | null;
  };
};

export async function getPortfolioReadModel({
  repository = new PortfolioRepository(),
  marketDataService = new MarketDataService(),
  baseCurrency = "EUR",
}: {
  repository?: PortfolioRepository;
  marketDataService?: MarketDataService;
  baseCurrency?: string;
} = {}): Promise<PortfolioReadModel> {
  const [assets, accounts, transactions] = await Promise.all([
    repository.listAssets(),
    repository.listAccounts(),
    repository.listTransactions(),
  ]);
  const marketData = await marketDataService.getCurrentPrices({ assets, baseCurrency });
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const holdings = buildHoldingRows(assets, accounts, transactions, portfolio, marketData.prices);

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
    valuation: {
      totalValue: portfolio.totalValue,
      currency: baseCurrency,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
    },
  };
}

function buildHoldingRows(
  assets: AssetRow[],
  accounts: AccountRow[],
  transactions: TransactionWithRelations[],
  portfolio: ReturnType<typeof calculatePortfolio>,
  marketPrices: Awaited<ReturnType<MarketDataService["getCurrentPrices"]>>["prices"],
): PortfolioHoldingRow[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const holdings = portfolio.holdings;
  const costBasisByHolding = calculateCostBasis(transactions);
  const valuedByHolding = new Map(
    portfolio.valuedHoldings.map((holding) => [holdingKey(holding.accountId, holding.assetId), holding]),
  );
  const pricesByAsset = new Map(marketPrices.map((price) => [price.assetId, price]));

  const rows = holdings.map((holding) => {
    const asset = assetsById.get(holding.assetId);
    const account = accountsById.get(holding.accountId);
    const costBasis = costBasisByHolding.get(holdingKey(holding.accountId, holding.assetId));
    const valuedHolding = valuedByHolding.get(holdingKey(holding.accountId, holding.assetId));
    const marketPrice = pricesByAsset.get(holding.assetId);
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
      currentValue: marketPrice && valuedHolding ? decimal(valuedHolding.value).toFixed(2) : null,
      currentPrice: marketPrice ? decimal(marketPrice.price).toFixed(2) : null,
      priceSource: marketPrice?.source ?? null,
      priceTimestamp: marketPrice?.timestamp.toISOString() ?? null,
      isPriceStale: marketPrice?.isStale ?? false,
      averageAcquisitionPrice,
      pnl:
        marketPrice && valuedHolding && costBasis
          ? decimal(valuedHolding.value).minus(costBasis.cost).toFixed(2)
          : null,
      assetClass: asset?.assetClass ?? "OTHER",
      assetType: asset?.assetType ?? "OTHER",
      portfolioWeight: null,
      quantityLabel: asset?.assetType === AssetType.PHYSICAL_GOLD ? `${holding.quantity} g` : holding.quantity,
    };
  });

  const totalAvailableValue = decimal(portfolio.totalValue);

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
