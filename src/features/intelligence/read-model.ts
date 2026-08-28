import { PortfolioRuleType } from "@prisma/client";
import {
  calculateDailyBrief,
  type DailyBriefResult,
  type DailyBriefStrategyRules,
  type HistoricalMarketSnapshot,
} from "@/features/portfolio-engine";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { DailyMarketPriceRepository, type DailyMarketPriceStore } from "@/features/performance/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { serializeDecimal } from "@/lib/db/decimal";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export type IntelligenceReadModel = {
  currency: string;
  lastUpdated: string | null;
  marketDataWarning: string | null;
  brief: DailyBriefResult;
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
  const snapshotsByDate = new Map<string, { marketPrices: Record<string, string>; hasStalePrices: boolean }>();

  for (const dailyPrice of dailyPrices) {
    const asset = assetById.get(dailyPrice.assetId);
    if (!asset) continue;
    const date = dailyPrice.date.toISOString().slice(0, 10);
    const snapshot = snapshotsByDate.get(date) ?? { marketPrices: {}, hasStalePrices: false };
    snapshot.marketPrices[asset.symbol] = serializeDecimal(dailyPrice.price);
    snapshot.hasStalePrices ||= dailyPrice.isStaleAtCapture;
    snapshotsByDate.set(date, snapshot);
  }

  const history: HistoricalMarketSnapshot[] = [...snapshotsByDate.entries()]
    .map(([date, snapshot]) => ({ date, ...snapshot }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    currency,
    lastUpdated: marketData.lastUpdated,
    marketDataWarning: marketData.warning,
    brief: calculateDailyBrief({
      assets,
      accounts,
      transactions,
      baseCurrency: currency,
      currentMarketPrices: toEngineMarketPrices(marketData),
      currentHasStalePrices: marketData.hasStalePrices,
      history,
      strategy: strategy?.allocations ?? null,
      rules: parseRules(strategy?.portfolioRules ?? []),
      asOf: now,
    }),
  };
}

function parseRules(rules: Array<{ type: PortfolioRuleType; enabled: boolean; config: unknown }>): DailyBriefStrategyRules {
  const byType = new Map(rules.map((rule) => [rule.type, rule]));
  const driftConfig = byType.get(PortfolioRuleType.MIN_REBALANCE_DRIFT)?.config;
  const minDriftPercent = driftConfig && typeof driftConfig === "object" && "minDriftPercent" in driftConfig
    ? String(driftConfig.minDriftPercent)
    : "2";

  return {
    preferContributionsOverSelling: byType.get(PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING)?.enabled ?? true,
    challengeStrategyViolations: byType.get(PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS)?.enabled ?? true,
    preferNoActionWhenEvidenceWeak: byType.get(PortfolioRuleType.PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK)?.enabled ?? true,
    minimumRebalanceDrift: minDriftPercent,
  };
}
