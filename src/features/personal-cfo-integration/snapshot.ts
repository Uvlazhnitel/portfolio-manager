import "server-only";

import { AssetClass } from "@prisma/client";
import { calculatePortfolio, exactPortfolioValue } from "@/features/portfolio-engine";
import { decimal, ZERO } from "@/features/portfolio-engine/decimal";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import type { ResolvedMarketPrice } from "@/features/market-data/types";
import type { PersonalCfoIdentity } from "@/features/personal-cfo-integration/contract";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

type SnapshotPortfolioRepository = Pick<PortfolioRepository, "listAssets" | "listAccounts" | "listTransactions">;
type SnapshotStrategyRepository = Pick<StrategyRepository, "findActiveStrategy">;
type SnapshotMarketDataService = Pick<MarketDataService, "getCurrentPrices">;

export async function buildPersonalCfoSnapshot({
  identity,
  repository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
  now = new Date(),
}: {
  identity: PersonalCfoIdentity;
  repository?: SnapshotPortfolioRepository;
  strategyRepository?: SnapshotStrategyRepository;
  marketDataService?: SnapshotMarketDataService;
  now?: Date;
}) {
  const [assets, accounts, transactions, strategy] = await Promise.all([
    repository.listAssets(),
    repository.listAccounts(),
    repository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const reportingCurrency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const marketData = await marketDataService.getCurrentPrices({
    assets,
    baseCurrency: reportingCurrency,
    now,
  });
  const portfolio = calculatePortfolio({
    assets,
    transactions,
    marketPrices: toEngineMarketPrices(marketData),
  });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const accountIds = new Set(accounts.map((account) => account.id));
  const priceByAssetId = new Map(marketData.prices.map((price) => [price.assetId, price]));
  const missingPriceSymbols = [...new Set(portfolio.missingPriceSymbols)].sort();
  const status = missingPriceSymbols.length > 0 ? "partial" as const : "complete" as const;

  const holdings = portfolio.holdings.map((holding) => {
    const asset = assetById.get(holding.assetId);
    if (!asset || !accountIds.has(holding.accountId)) {
      throw new Error("Portfolio holding references unavailable account or asset metadata.");
    }
    const price = priceByAssetId.get(holding.assetId);
    const currentMarketValue = price
      ? decimal(holding.quantity).mul(price.price).toString()
      : null;
    return {
      providerHoldingId: `${holding.accountId}:${holding.assetId}`,
      accountId: holding.accountId,
      assetId: holding.assetId,
      symbol: asset.symbol,
      name: asset.name,
      assetClass: asset.assetClass,
      assetType: asset.assetType,
      quantity: decimal(holding.quantity).toString(),
      currentMarketValue,
      price: price ? decimal(price.price).toString() : null,
      priceCurrency: price?.currency ?? null,
      priceSource: price?.source ?? null,
      priceTimestamp: componentTimestamp(price),
      isPriceStale: price?.isStale ?? false,
    };
  }).sort((left, right) => left.providerHoldingId.localeCompare(right.providerHoldingId));

  const heldIds = new Set(holdings.map((holding) => holding.assetId));
  const heldPrices = marketData.prices.filter((price) => heldIds.has(price.assetId));
  const sourceTimestamps = heldPrices
    .flatMap((price) => componentTimestamp(price) ? [price.timestamp] : [])
    .sort((left, right) => left.getTime() - right.getTime());
  const cashHoldings = holdings.filter((holding) => holding.assetClass === AssetClass.CASH);
  const cashIsComplete = cashHoldings.every((holding) => holding.currentMarketValue !== null);
  const cashAmount = cashIsComplete
    ? cashHoldings.reduce(
        (total, holding) => total.plus(holding.currentMarketValue ?? ZERO),
        ZERO,
      ).toString()
    : null;
  const knownValuedSubtotal = exactPortfolioValue(portfolio).toString();

  return {
    ...identity,
    generatedAt: now.toISOString(),
    reportingCurrency,
    valuation: {
      status,
      totalValue: status === "complete" ? knownValuedSubtotal : null,
      knownValuedSubtotal,
      missingPriceSymbols,
      hasStalePrices: heldPrices.some((price) => price.isStale),
      sourceAsOf: sourceTimestamps[0]?.toISOString() ?? null,
      sourceAsOfSemantics: "oldest_component_quote" as const,
    },
    cash: {
      treatment: "included_in_total" as const,
      amount: cashAmount,
      currency: reportingCurrency,
    },
    holdings: {
      completeness: status,
      items: holdings,
    },
  };
}

function componentTimestamp(price: ResolvedMarketPrice | undefined) {
  if (!price || price.source.toUpperCase() === "BASE_CURRENCY") return null;
  return price.timestamp.toISOString();
}

export type PersonalCfoSnapshot = Awaited<ReturnType<typeof buildPersonalCfoSnapshot>>;
