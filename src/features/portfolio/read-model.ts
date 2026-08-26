import { AssetType, type Prisma } from "@prisma/client";
import { calculateHoldingCostBasis, calculatePortfolio, calculatePortfolioAnalytics, compareAllocationToStrategy } from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal, serializeNullableDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import {
  formatPhysicalGoldQuantity,
  pricePerTroyOunce,
} from "@/features/market-data/gold";

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
  displayPriceUnit: "unit" | "troy oz";
  pnl: string | null;
  assetClass: string;
  assetType: string;
  portfolioWeight: string | null;
  quantityLabel: string;
  imageUrl: string | null;
};

export type PortfolioTransactionRow = {
  id: string;
  type: string;
  assetName: string;
  symbol: string;
  accountName: string;
  quantity: string;
  quantityLabel: string;
  pricePerUnit: string | null;
  displayPricePerUnit: string | null;
  displayPriceUnit: "unit" | "troy oz";
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
    imageUrl: string | null;
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
    totalUnrealizedPnl: string | null;
    investmentGain: string | null;
    netInvested: string | null;
    externalContributions: string | null;
    externalWithdrawals: string | null;
    simpleReturnPercent: string | null;
  };
  strategyStatus: {
    name: string;
    inRangeCount: number;
    totalCount: number;
    comparisons: Array<{
      assetClass: string;
      currentPercent: string;
      targetPercent: string;
      minPercent: string;
      maxPercent: string;
      status: "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT";
    }>;
  } | null;
};

export async function getPortfolioReadModel({
  repository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
  baseCurrency,
}: {
  repository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
  baseCurrency?: string;
} = {}): Promise<PortfolioReadModel> {
  const [assets, accounts, transactions, strategy] = await Promise.all([
    repository.listAssets(),
    repository.listAccounts(),
    repository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const resolvedBaseCurrency = baseCurrency ?? strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const marketData = await marketDataService.getCurrentPrices({ assets, baseCurrency: resolvedBaseCurrency });
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: resolvedBaseCurrency });
  const holdings = buildHoldingRows(assets, accounts, transactions, portfolio, marketData.prices, resolvedBaseCurrency);
  const strategyComparisons = strategy
    ? compareAllocationToStrategy(portfolio, strategy.allocations)
    : [];

  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      currency: asset.currency,
      imageUrl: imageUrlFromMetadata(asset.metadata),
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
      currency: resolvedBaseCurrency,
      isPartial: portfolio.missingPriceSymbols.length > 0,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
      totalUnrealizedPnl: analytics.totalUnrealizedPnl,
      investmentGain: analytics.investmentGain,
      netInvested: analytics.netInvested,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      simpleReturnPercent: analytics.simpleReturnPercent,
    },
    strategyStatus: strategy
      ? {
          name: strategy.name,
          inRangeCount: strategyComparisons.filter((comparison) => comparison.status === "IN_RANGE").length,
          totalCount: strategyComparisons.length,
          comparisons: strategyComparisons.map((comparison) => ({
            assetClass: comparison.assetClass,
            currentPercent: comparison.currentPercent,
            targetPercent: comparison.targetPercent,
            minPercent: comparison.minPercent,
            maxPercent: comparison.maxPercent,
            status: comparison.status,
          })),
        }
      : null,
  };
}

function buildHoldingRows(
  assets: AssetRow[],
  accounts: AccountRow[],
  transactions: TransactionWithRelations[],
  portfolio: ReturnType<typeof calculatePortfolio>,
  marketPrices: Awaited<ReturnType<MarketDataService["getCurrentPrices"]>>["prices"],
  baseCurrency: string,
): PortfolioHoldingRow[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const holdings = portfolio.holdings;
  const costBasisByHolding = new Map(
    calculateHoldingCostBasis({ portfolio, assets, transactions, baseCurrency }).map((basis) => [
      holdingKey(basis.accountId, basis.assetId),
      basis,
    ]),
  );
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
    const isPhysicalGold = asset?.assetType === AssetType.PHYSICAL_GOLD;
    const displayPriceUnit: PortfolioHoldingRow["displayPriceUnit"] = isPhysicalGold ? "troy oz" : "unit";
    const averageAcquisitionPrice = costBasis?.status === "AVAILABLE" && costBasis.averageAcquisitionPrice !== null
      ? displayUnitPrice(costBasis.averageAcquisitionPrice, isPhysicalGold).toString()
      : null;

    return {
      assetId: holding.assetId,
      accountId: holding.accountId,
      assetName: asset?.name ?? "Unknown asset",
      symbol: asset?.symbol ?? "UNKNOWN",
      accountName: account?.name ?? "Unknown account",
      quantity: holding.quantity,
      currentValue: marketPrice && valuedHolding ? decimal(valuedHolding.value).toFixed(2) : null,
      currentPrice: marketPrice ? displayUnitPrice(marketPrice.price, isPhysicalGold).toFixed(2) : null,
      priceSource: marketPrice?.source ?? null,
      priceTimestamp: marketPrice?.timestamp.toISOString() ?? null,
      isPriceStale: marketPrice?.isStale ?? false,
      averageAcquisitionPrice,
      displayPriceUnit,
      pnl:
        marketPrice && valuedHolding && costBasis?.status === "AVAILABLE" && costBasis.totalCost !== null
          ? decimal(valuedHolding.value).minus(costBasis.totalCost).toFixed(2)
          : null,
      assetClass: asset?.assetClass ?? "OTHER",
      assetType: asset?.assetType ?? "OTHER",
      portfolioWeight: null,
      quantityLabel: isPhysicalGold ? formatPhysicalGoldQuantity(holding.quantity) : holding.quantity,
      imageUrl: imageUrlFromMetadata(asset?.metadata),
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

function imageUrlFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("imageUrl" in metadata)) return null;
  return typeof metadata.imageUrl === "string" ? metadata.imageUrl : null;
}

export function serializeTransactionRow(transaction: TransactionWithRelations): PortfolioTransactionRow {
  const isPhysicalGold = transaction.asset.assetType === AssetType.PHYSICAL_GOLD;

  return {
    id: transaction.id,
    type: transaction.type,
    assetName: transaction.asset.name,
    symbol: transaction.asset.symbol,
    accountName: transaction.account.name,
    quantity: serializeDecimal(transaction.quantity),
    quantityLabel: isPhysicalGold
      ? formatPhysicalGoldQuantity(transaction.quantity)
      : serializeDecimal(transaction.quantity),
    pricePerUnit: serializeNullableDecimal(transaction.pricePerUnit),
    displayPricePerUnit: transaction.pricePerUnit
      ? displayUnitPrice(transaction.pricePerUnit, isPhysicalGold).toString()
      : null,
    displayPriceUnit: isPhysicalGold ? "troy oz" : "unit",
    fee: serializeNullableDecimal(transaction.fee),
    currency: transaction.currency,
    executedAt: transaction.executedAt.toISOString(),
    note: transaction.note,
  };
}

function displayUnitPrice(value: Prisma.Decimal | string, isPhysicalGold: boolean) {
  return isPhysicalGold ? pricePerTroyOunce(value) : decimal(value);
}

export function holdingKey(accountId: string, assetId: string) {
  return `${accountId}:${assetId}`;
}
