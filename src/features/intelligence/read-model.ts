import { PortfolioRuleType } from "@prisma/client";
import {
  calculatePortfolioReview,
  type PortfolioPriceObservation,
  type PortfolioReview,
  type PortfolioReviewBaseline,
  type PortfolioReviewRules,
} from "@/features/portfolio-engine";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";
import { riskThresholdsFromRules } from "@/features/risk/config";

export type IntelligenceReadModel = {
  currency: string;
  lastUpdated: string | null;
  review: PortfolioReview;
};

export async function getIntelligenceReadModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  marketDataService = new MarketDataService(),
  dailyPriceStore = new DailyMarketPriceRepository(),
  now = new Date(),
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  marketDataService?: MarketDataService;
  dailyPriceStore?: DailyMarketPriceStore;
  now?: Date;
} = {}): Promise<IntelligenceReadModel> {
  const [assets, accounts, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listAccounts(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  const currency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [marketData, dailyPrices] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency: currency, now }),
    dailyPriceStore.listDailyPrices(currency),
  ]);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotsByDate = new Map<string, {
    marketPrices: Record<string, string>;
    priceObservations: PortfolioPriceObservation[];
    hasStalePrices: boolean;
  }>();

  for (const dailyPrice of dailyPrices) {
    const asset = assetById.get(dailyPrice.assetId);
    if (!asset) continue;
    const date = dailyPrice.date.toISOString().slice(0, 10);
    const snapshot = snapshotsByDate.get(date) ?? { marketPrices: {}, priceObservations: [], hasStalePrices: false };
    const price = serializeDecimal(dailyPrice.price);
    snapshot.marketPrices[asset.symbol] = price;
    snapshot.priceObservations.push({
      assetId: asset.id,
      symbol: asset.symbol,
      price,
      source: dailyPrice.source,
      quoteTimestamp: dailyPrice.quoteTimestamp,
      capturedAt: dailyPrice.capturedAt,
      isStale: dailyPrice.isStaleAtCapture,
    });
    snapshot.hasStalePrices ||= dailyPrice.isStaleAtCapture;
    snapshotsByDate.set(date, snapshot);
  }

  const currentDate = now.toISOString().slice(0, 10);
  const previousEntry = [...snapshotsByDate.entries()]
    .filter(([date]) => date < currentDate)
    .sort(([left], [right]) => right.localeCompare(left))[0] ?? null;
  const baseline: PortfolioReviewBaseline | null = previousEntry
    ? {
      kind: "PREVIOUS_DAILY_OBSERVATION",
      asOf: `${previousEntry[0]}T23:59:59.999Z`,
      ...previousEntry[1],
    }
    : null;

  return {
    currency,
    lastUpdated: marketData.lastUpdated,
    review: calculatePortfolioReview({
      assets,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        custodian: account.custodian
          ? { id: account.custodian.id, name: account.custodian.name, category: account.custodian.category }
          : null,
      })),
      transactions,
      baseCurrency: currency,
      currentMarketPrices: toEngineMarketPrices(marketData),
      currentPriceObservations: marketData.prices.map((price) => ({
        assetId: price.assetId,
        symbol: price.symbol,
        price: price.price,
        source: price.source,
        quoteTimestamp: price.timestamp,
        capturedAt: price.fetchedAt,
        isStale: price.isStale,
      })),
      currentHasStalePrices: marketData.hasStalePrices,
      marketDataWarning: marketData.warning,
      baseline,
      strategy: strategy?.allocations ?? null,
      rules: parseRules(strategy?.portfolioRules ?? []),
      riskThresholds: riskThresholdsFromRules(strategy?.portfolioRules ?? []),
      asOf: now,
    }),
  };
}

function parseRules(rules: Array<{ type: PortfolioRuleType; enabled: boolean; config: unknown }>): PortfolioReviewRules {
  const byType = new Map(rules.map((rule) => [rule.type, rule]));
  const driftConfig = byType.get(PortfolioRuleType.MIN_REBALANCE_DRIFT)?.config;
  const minDriftPercent = driftConfig && typeof driftConfig === "object" && "minDriftPercent" in driftConfig
    ? String(driftConfig.minDriftPercent)
    : "2";

  return {
    preferContributionsOverSelling: byType.get(PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING)?.enabled ?? true,
    challengeStrategyViolations: byType.get(PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS)?.enabled ?? true,
    strategyMaterialityPercent: minDriftPercent,
    riskMaterialityPercent: "1",
  };
}
