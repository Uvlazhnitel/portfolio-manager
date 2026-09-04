import { AssetType } from "@prisma/client";
import {
  calculateAssetNetCostBasis,
  calculateHoldingCostBasis,
  calculatePortfolio,
  calculatePortfolioAnalytics,
  calculatePortfolioRisk,
  compareAllocationToStrategy,
  getPortfolioValuationAvailability,
  type ContributionProjection,
  type PortfolioRiskSnapshot,
} from "@/features/portfolio-engine";
import { buildSavedContributionProjection } from "@/features/contributions/saved-plan";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { buildPortfolioValuationPresentation } from "@/features/portfolio/valuation-presentation";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { riskThresholdsFromRules } from "@/features/risk/config";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal, serializeNullableDecimal, type DecimalValue } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import {
  formatPhysicalGoldQuantity,
  gramsToTroyOunces,
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
  accountingAverageCost: string | null;
  averageNetCost: string | null;
  netCost: string | null;
  displayPriceUnit: "unit" | "troy oz";
  pnl: string | null;
  netPnl: string | null;
  assetClass: string;
  assetType: string;
  portfolioWeight: string | null;
  quantityLabel: string;
  imageUrl: string | null;
};

export type PortfolioTransactionRow = {
  id: string;
  groupId: string | null;
  operationKind: "TRANSACTION" | "TRANSFER" | "TRADE";
  assetId: string;
  accountId: string;
  type: string;
  basisMethod: string | null;
  assetName: string;
  symbol: string;
  accountName: string;
  quantity: string;
  inputQuantity: string;
  quantityLabel: string;
  pricePerUnit: string | null;
  displayPricePerUnit: string | null;
  displayPriceUnit: "unit" | "troy oz";
  fee: string | null;
  currency: string;
  executedAt: string;
  note: string | null;
  destination: PortfolioOperationLeg | null;
};

export type PortfolioOperationLeg = {
  id: string;
  assetId: string;
  accountId: string;
  type: string;
  assetName: string;
  symbol: string;
  accountName: string;
  quantity: string;
  inputQuantity: string;
  quantityLabel: string;
};

export type PortfolioReadModel = {
  custodians: Array<{ id: string; name: string; category: string }>;
  assets: Array<{
    id: string;
    symbol: string;
    name: string;
    assetClass: string;
    assetType: string;
    currency: string;
    quoteProvider: string | null;
    quoteSymbol: string | null;
    quoteMicCode: string | null;
    imageUrl: string | null;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    custodianId: string | null;
    custodianName: string | null;
  }>;
  holdings: PortfolioHoldingRow[];
  transactions: PortfolioTransactionRow[];
  valuation: {
    totalValue: string;
    exactTotalValue: string | null;
    knownValuedSubtotal: string;
    currency: string;
    isPartial: boolean;
    missingPriceSymbols: string[];
    lastUpdated: string | null;
    hasStalePrices: boolean;
    warning: string | null;
    totalUnrealizedPnl: string | null;
    investmentGain: string | null;
    netInvested: string;
    externalContributions: string | null;
    externalWithdrawals: string | null;
    trackedCapitalReturnPercent: string | null;
    trackedCapital: string;
    openingBasis: string;
    giftTrackingBasis: string;
    isCostBasisPartial: boolean;
    missingCostBasisSymbols: string[];
  };
  strategyStatus: {
    state: "AVAILABLE" | "UNAVAILABLE";
    name: string;
    inRangeCount: number | null;
    totalCount: number;
    reasonCodes: string[];
    missingPriceSymbols: string[];
    comparisons: Array<{
      assetClass: string;
      currentPercent: string;
      targetPercent: string;
      minPercent: string;
      maxPercent: string;
      status: "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT";
    }>;
  } | null;
  risk: PortfolioRiskSnapshot;
  contribution: {
    amount: string;
    projection: ContributionProjection | null;
    state: "AVAILABLE" | "UNAVAILABLE";
    reasonCodes: string[];
    missingPriceSymbols: string[];
  };
};

export async function getPortfolioReadModel({
  repository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  contributionPlanRepository = new ContributionPlanRepository(),
  marketDataService = new MarketDataService(),
  baseCurrency,
}: {
  repository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  contributionPlanRepository?: ContributionPlanRepository;
  marketDataService?: MarketDataService;
  baseCurrency?: string;
} = {}): Promise<PortfolioReadModel> {
  const [assets, accounts, custodians, transactions, strategy] = await Promise.all([
    repository.listAssets(),
    repository.listAccounts(),
    repository.listCustodians(),
    repository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const resolvedBaseCurrency = baseCurrency ?? strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [marketData, savedPlan] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency: resolvedBaseCurrency }),
    strategy ? contributionPlanRepository.findByStrategyId(strategy.id) : null,
  ]);
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const valuationPresentation = buildPortfolioValuationPresentation(portfolio);
  const analytics = calculatePortfolioAnalytics({ portfolio, assets, transactions, baseCurrency: resolvedBaseCurrency });
  const valuationAvailability = getPortfolioValuationAvailability(portfolio);
  const holdings = buildHoldingRows(assets, accounts, transactions, portfolio, marketData.prices, resolvedBaseCurrency);
  const strategyComparisons = strategy && valuationAvailability.state === "AVAILABLE"
    ? compareAllocationToStrategy(portfolio, strategy.allocations)
    : [];
  const risk = calculatePortfolioRisk({
    portfolio,
    assets,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      custodian: account.custodian
        ? {
            id: account.custodian.id,
            name: account.custodian.name,
            category: account.custodian.category,
          }
        : null,
    })),
    strategy: strategy?.allocations ?? null,
    thresholds: riskThresholdsFromRules(strategy?.portfolioRules ?? []),
    hasStalePrices: marketData.hasStalePrices,
  });
  const contributionAmount = savedPlan ? serializeDecimal(savedPlan.contributionAmount) : "";
  let contributionProjection: ContributionProjection | null = null;
  if (strategy && savedPlan && valuationAvailability.state === "AVAILABLE" && contributionAmount && contributionAmount !== "0") {
    try {
      contributionProjection = buildSavedContributionProjection({
        portfolio,
        assets,
        strategy: strategy.allocations,
        savedPlan,
      });
    } catch {
      contributionProjection = null;
    }
  }

  return {
    custodians: custodians.map((custodian) => ({ id: custodian.id, name: custodian.name, category: custodian.category })),
    assets: assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      currency: asset.currency,
      quoteProvider: asset.quoteProvider,
      quoteSymbol: asset.quoteSymbol,
      quoteMicCode: asset.quoteMicCode,
      imageUrl: imageUrlFromMetadata(asset.metadata),
    })),
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      description: account.description,
      custodianId: account.custodianId,
      custodianName: account.custodian?.name ?? null,
    })),
    holdings,
    transactions: buildTransactionRows(transactions),
    valuation: {
      totalValue: portfolio.totalValue,
      exactTotalValue: valuationPresentation.exactTotalValue,
      knownValuedSubtotal: valuationPresentation.knownValuedSubtotal,
      currency: resolvedBaseCurrency,
      isPartial: valuationPresentation.isPartial,
      missingPriceSymbols: valuationPresentation.missingPriceSymbols,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
      totalUnrealizedPnl: analytics.totalUnrealizedPnl,
      investmentGain: analytics.investmentGain,
      netInvested: analytics.netInvested,
      externalContributions: analytics.externalContributions,
      externalWithdrawals: analytics.externalWithdrawals,
      trackedCapitalReturnPercent: analytics.trackedCapitalReturnPercent,
      trackedCapital: analytics.trackedCapital,
      openingBasis: analytics.openingBasis,
      giftTrackingBasis: analytics.giftTrackingBasis,
      isCostBasisPartial: analytics.isCostBasisPartial,
      missingCostBasisSymbols: analytics.missingCostBasisSymbols,
    },
    strategyStatus: strategy
      ? {
          state: valuationAvailability.state === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
          name: strategy.name,
          inRangeCount: valuationAvailability.state === "AVAILABLE"
            ? strategyComparisons.filter((comparison) => comparison.status === "IN_RANGE").length
            : null,
          totalCount: strategy.allocations.length,
          reasonCodes: valuationAvailability.reasonCodes,
          missingPriceSymbols: valuationAvailability.missingPriceSymbols,
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
    risk,
    contribution: {
      amount: contributionAmount,
      projection: contributionProjection,
      state: valuationAvailability.state === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
      reasonCodes: valuationAvailability.reasonCodes,
      missingPriceSymbols: valuationAvailability.missingPriceSymbols,
    },
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
  const netCostByAsset = new Map(
    calculateAssetNetCostBasis({ portfolio, assets, transactions, baseCurrency }).map((basis) => [
      basis.assetId,
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
    const netCostBasis = netCostByAsset.get(holding.assetId);
    const valuedHolding = valuedByHolding.get(holdingKey(holding.accountId, holding.assetId));
    const marketPrice = pricesByAsset.get(holding.assetId);
    const isPhysicalGold = asset?.assetType === AssetType.PHYSICAL_GOLD;
    const displayPriceUnit: PortfolioHoldingRow["displayPriceUnit"] = isPhysicalGold ? "troy oz" : "unit";
    const averageAcquisitionPrice = costBasis?.status === "AVAILABLE" && costBasis.averageAcquisitionPrice !== null
      ? displayUnitPrice(costBasis.averageAcquisitionPrice, isPhysicalGold).toString()
      : null;
    const averageNetCost = netCostBasis?.status === "AVAILABLE" && netCostBasis.averageNetCost !== null
      ? displayUnitPrice(netCostBasis.averageNetCost, isPhysicalGold).toString()
      : null;
    const rowNetCost = netCostBasis?.status === "AVAILABLE" && netCostBasis.averageNetCost !== null
      ? decimal(netCostBasis.averageNetCost).mul(holding.quantity)
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
      accountingAverageCost: averageAcquisitionPrice,
      averageNetCost,
      netCost: rowNetCost ? rowNetCost.toFixed(2) : null,
      displayPriceUnit,
      pnl:
        marketPrice && valuedHolding && costBasis?.status === "AVAILABLE" && costBasis.totalCost !== null
          ? decimal(valuedHolding.value).minus(costBasis.totalCost).toFixed(2)
          : null,
      netPnl:
        marketPrice && valuedHolding && rowNetCost
          ? decimal(valuedHolding.value).minus(rowNetCost).toFixed(2)
          : null,
      assetClass: asset?.assetClass ?? "OTHER",
      assetType: asset?.assetType ?? "OTHER",
      portfolioWeight: null,
      quantityLabel: isPhysicalGold ? formatPhysicalGoldQuantity(holding.quantity) : holding.quantity,
      imageUrl: imageUrlFromMetadata(asset?.metadata),
    };
  });

  const totalAvailableValue = decimal(portfolio.totalValue);
  const exactWeightsAvailable = getPortfolioValuationAvailability(portfolio).exactPercentagesAvailable;

  return rows.map((row) => ({
    ...row,
    portfolioWeight:
      exactWeightsAvailable && row.currentValue && totalAvailableValue.greaterThan(ZERO)
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
    groupId: transaction.transactionGroupId,
    operationKind: transaction.transactionGroup?.kind ?? "TRANSACTION",
    assetId: transaction.assetId,
    accountId: transaction.accountId,
    type: transaction.type,
    basisMethod: transaction.basisMethod,
    assetName: transaction.asset.name,
    symbol: transaction.asset.symbol,
    accountName: transaction.account.name,
    quantity: serializeDecimal(transaction.quantity),
    inputQuantity: isPhysicalGold
      ? gramsToTroyOunces(transaction.quantity).toString()
      : serializeDecimal(transaction.quantity),
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
    destination: null,
  };
}

function buildTransactionRows(transactions: TransactionWithRelations[]): PortfolioTransactionRow[] {
  const rows: PortfolioTransactionRow[] = [];
  const seenGroups = new Set<string>();
  for (const transaction of transactions) {
    if (!transaction.transactionGroupId || !transaction.transactionGroup) {
      rows.push(serializeTransactionRow(transaction));
      continue;
    }
    if (seenGroups.has(transaction.transactionGroupId)) continue;
    seenGroups.add(transaction.transactionGroupId);
    const legs = transactions.filter((candidate) => candidate.transactionGroupId === transaction.transactionGroupId);
    const sourceType = transaction.transactionGroup.kind === "TRANSFER" ? "TRANSFER_OUT" : "SELL";
    const destinationType = transaction.transactionGroup.kind === "TRANSFER" ? "TRANSFER_IN" : "BUY";
    const source = legs.find((leg) => leg.type === sourceType);
    const destination = legs.find((leg) => leg.type === destinationType);
    if (!source || !destination) {
      rows.push(...legs.map(serializeTransactionRow));
      continue;
    }
    rows.push({
      ...serializeTransactionRow(source),
      id: transaction.transactionGroupId,
      type: transaction.transactionGroup.kind,
      operationKind: transaction.transactionGroup.kind,
      fee: serializeNullableDecimal(destination.fee),
      destination: serializeOperationLeg(destination),
    });
  }
  return rows;
}

function serializeOperationLeg(transaction: TransactionWithRelations): PortfolioOperationLeg {
  const row = serializeTransactionRow(transaction);
  return {
    id: transaction.id,
    assetId: row.assetId,
    accountId: row.accountId,
    type: row.type,
    assetName: row.assetName,
    symbol: row.symbol,
    accountName: row.accountName,
    quantity: row.quantity,
    inputQuantity: row.inputQuantity,
    quantityLabel: row.quantityLabel,
  };
}

function displayUnitPrice(value: DecimalValue | string, isPhysicalGold: boolean) {
  return isPhysicalGold ? pricePerTroyOunce(value.toString()) : decimal(value.toString());
}

export function holdingKey(accountId: string, assetId: string) {
  return `${accountId}:${assetId}`;
}
