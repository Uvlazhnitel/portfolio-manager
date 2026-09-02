import { AssetClass } from "@prisma/client";
import {
  buildContributionProjection,
  calculatePortfolio,
  getPortfolioValuationAvailability,
  projectCustomContribution,
  type ContributionProjection,
} from "@/features/portfolio-engine";
import { MarketDataService, toEngineMarketPrices } from "@/features/market-data/service";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { StrategyRepository } from "@/features/strategy/repository";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { parseSavedContributionAllocations } from "@/features/contributions/saved-plan";
import {
  parsePreviewInput,
  validateContributionAllocations,
  type ContributionPreviewInput,
  type ParsedContributionAllocation,
} from "@/features/contributions/validation";
import { serializeDecimal } from "@/lib/db/decimal";

export type ContributionPlannerModel = {
  strategy: { id: string; name: string; currency: string; allocations: Array<{ assetClass: AssetClass; hasAssetTargets: boolean }> };
  contributionAmount: string;
  allocations: ParsedContributionAllocation[];
  recommendedAllocations: ParsedContributionAllocation[];
  projection: ContributionProjection | null;
  isCustomized: boolean;
  savedAt: string | null;
  setupError: string | null;
  availability: {
    state: "AVAILABLE" | "UNAVAILABLE";
    reasonCodes: string[];
    missingPriceSymbols: string[];
  };
  valuation: {
    isPartial: boolean;
    missingPriceSymbols: string[];
    lastUpdated: string | null;
    hasStalePrices: boolean;
    warning: string | null;
  };
};

export async function getContributionPlannerModel({
  portfolioRepository = new PortfolioRepository(),
  strategyRepository = new StrategyRepository(),
  planRepository = new ContributionPlanRepository(),
  marketDataService = new MarketDataService(),
  preferredAmount = null,
}: {
  portfolioRepository?: PortfolioRepository;
  strategyRepository?: StrategyRepository;
  planRepository?: ContributionPlanRepository;
  marketDataService?: MarketDataService;
  preferredAmount?: string | null;
} = {}): Promise<ContributionPlannerModel> {
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  if (!strategy) {
    throw new Error("Create an investment strategy before planning a contribution.");
  }
  const [marketData, saved] = await Promise.all([
    marketDataService.getCurrentPrices({ assets, baseCurrency: strategy.baseCurrency }),
    planRepository.findByStrategyId(strategy.id),
  ]);
  const portfolio = calculatePortfolio({ assets, transactions, marketPrices: toEngineMarketPrices(marketData) });
  const valuationAvailability = getPortfolioValuationAvailability(portfolio);
  const canPlan = valuationAvailability.state === "AVAILABLE";
  const contributionAmount = preferredAmount ?? (saved ? serializeDecimal(saved.contributionAmount) : "");
  let setupError: string | null = canPlan ? null : incompleteValuationMessage(valuationAvailability.missingPriceSymbols);
  let recommendation: ContributionProjection | null = null;
  if (canPlan && contributionAmount && contributionAmount !== "0") {
    try {
      recommendation = buildContributionProjection({ portfolio, assets, strategy: strategy.allocations, contributionAmount });
    } catch (error) {
      setupError = error instanceof Error ? error.message : "Strategy asset targets are not configured.";
    }
  }
  const activeAssetClasses = strategy.allocations.map((allocation) => allocation.assetClass);
  const recommendedAllocations = normalizeAllocations(recommendation?.plan.allocations ?? [], activeAssetClasses);
  const shouldRestoreSavedAllocation = !preferredAmount && Boolean(saved);
  const savedAllocations = shouldRestoreSavedAllocation && saved ? parseSavedContributionAllocations(saved.allocations) : [];
  const allocations = shouldRestoreSavedAllocation ? normalizeAllocations(savedAllocations, activeAssetClasses) : recommendedAllocations;
  let projection: ContributionProjection | null = null;
  if (canPlan && contributionAmount && contributionAmount !== "0" && !setupError) {
    try {
      projection = projectCustomContribution({ portfolio, assets, strategy: strategy.allocations, contributionAmount, allocations });
    } catch (error) {
      setupError = error instanceof Error ? error.message : "Strategy asset targets are not configured.";
    }
  }

  return {
    strategy: {
      id: strategy.id,
      name: strategy.name,
      currency: strategy.baseCurrency,
      allocations: strategy.allocations.map((allocation) => ({
        assetClass: allocation.assetClass,
        hasAssetTargets: allocation.assetAllocations.length > 0,
      })),
    },
    contributionAmount,
    allocations,
    recommendedAllocations,
    projection,
    isCustomized: shouldRestoreSavedAllocation ? saved?.isCustomized ?? false : false,
    savedAt: saved?.updatedAt.toISOString() ?? null,
    setupError,
    availability: {
      state: canPlan ? "AVAILABLE" : "UNAVAILABLE",
      reasonCodes: valuationAvailability.reasonCodes,
      missingPriceSymbols: valuationAvailability.missingPriceSymbols,
    },
    valuation: {
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
    },
  };
}

export async function previewContribution(
  input: ContributionPreviewInput,
  {
    portfolioRepository = new PortfolioRepository(),
    strategyRepository = new StrategyRepository(),
    marketDataService = new MarketDataService(),
  }: {
    portfolioRepository?: PortfolioRepository;
    strategyRepository?: StrategyRepository;
    marketDataService?: MarketDataService;
  } = {},
) {
  const parsed = parsePreviewInput(input);
  const [assets, transactions, strategy] = await Promise.all([
    portfolioRepository.listAssets(),
    portfolioRepository.listTransactions(),
    strategyRepository.findActiveStrategy(),
  ]);
  if (!strategy) throw new Error("Active strategy was not found.");
  const activeAssetClasses = strategy.allocations.map((allocation) => allocation.assetClass);
  if (parsed.allocations) {
    validateContributionAllocations(parsed.contributionAmount, parsed.allocations, activeAssetClasses);
  }
  const marketData = await marketDataService.getCurrentPrices({ assets, baseCurrency: strategy.baseCurrency });
  const portfolio = calculatePortfolio({ assets, transactions, marketPrices: toEngineMarketPrices(marketData) });
  const valuationAvailability = getPortfolioValuationAvailability(portfolio);
  if (valuationAvailability.state === "PARTIAL") {
    return {
      projection: null,
      recommendedAllocations: [],
      availability: {
        state: "UNAVAILABLE" as const,
        reasonCodes: valuationAvailability.reasonCodes,
        missingPriceSymbols: valuationAvailability.missingPriceSymbols,
      },
      valuation: {
        isPartial: true,
        missingPriceSymbols: valuationAvailability.missingPriceSymbols,
        lastUpdated: marketData.lastUpdated,
        hasStalePrices: marketData.hasStalePrices,
        warning: marketData.warning,
      },
    };
  }
  const projection = parsed.allocations
    ? projectCustomContribution({ portfolio, assets, strategy: strategy.allocations, contributionAmount: parsed.contributionAmount, allocations: parsed.allocations })
    : buildContributionProjection({ portfolio, assets, strategy: strategy.allocations, contributionAmount: parsed.contributionAmount });

  return {
    projection,
    recommendedAllocations: normalizeAllocations(
      buildContributionProjection({ portfolio, assets, strategy: strategy.allocations, contributionAmount: parsed.contributionAmount }).plan.allocations,
      activeAssetClasses,
    ),
    availability: {
      state: "AVAILABLE" as const,
      reasonCodes: [],
      missingPriceSymbols: [],
    },
    valuation: {
      isPartial: portfolio.missingPriceSymbols.length > 0,
      missingPriceSymbols: portfolio.missingPriceSymbols,
      lastUpdated: marketData.lastUpdated,
      hasStalePrices: marketData.hasStalePrices,
      warning: marketData.warning,
    },
  };
}

function incompleteValuationMessage(symbols: string[]) {
  return `Contribution planning is unavailable until prices are available for: ${symbols.join(", ")}.`;
}

function normalizeAllocations(allocations: Array<{ assetClass: AssetClass; amount: string }>, assetClasses: AssetClass[]) {
  const byClass = new Map(allocations.map((allocation) => [allocation.assetClass, allocation.amount]));
  return assetClasses.map((assetClass) => ({ assetClass, amount: byClass.get(assetClass) ?? "0.00" }));
}
