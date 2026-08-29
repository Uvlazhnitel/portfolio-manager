import { AssetClass, PortfolioRuleType } from "@prisma/client";
import { serializeDecimal } from "@/lib/db/decimal";
import { StrategyRepository } from "@/features/strategy/repository";
import { PortfolioRepository } from "@/features/portfolio/repository";
import { assetClassOrder, editableAssetClasses } from "@/features/strategy/validation";

type StrategyWithRelations = NonNullable<Awaited<ReturnType<StrategyRepository["findActiveStrategy"]>>>;

export type StrategyEditorModel = {
  id: string;
  name: string;
  objective: string;
  baseCurrency: string;
  updatedAt: string;
  allocations: Array<{
    assetClass: (typeof editableAssetClasses)[number];
    targetPercent: string;
    minPercent: string;
    maxPercent: string;
    assetTargets: Array<{
      assetId: string;
      symbol: string;
      name: string;
      targetPercent: string;
    }>;
  }>;
  availableAssets: Array<{
    id: string;
    symbol: string;
    name: string;
    assetClass: AssetClass;
  }>;
  rules: {
    preferContributionsOverSelling: boolean;
    challengeStrategyViolations: boolean;
    preferNoActionWhenEvidenceWeak: boolean;
    minimumRebalanceDrift: string;
    singleAssetLimitEnabled: boolean;
    singleAssetMaxPercent: string;
    custodianLimitEnabled: boolean;
    custodianMaxPercent: string;
  };
};

export async function getStrategyEditorModel(
  repository = new StrategyRepository(),
  portfolioRepository = new PortfolioRepository(),
) {
  const [strategy, assets] = await Promise.all([
    repository.findActiveStrategy(),
    portfolioRepository.listAssets(),
  ]);

  if (!strategy) {
    throw new Error("Active strategy is not configured. Run the database seed first.");
  }

  return toStrategyEditorModel(strategy, assets);
}

export function toStrategyEditorModel(
  strategy: StrategyWithRelations,
  availableAssets: Array<{ id: string; symbol: string; name: string; assetClass: AssetClass }> = [],
): StrategyEditorModel {
  const rulesByType = new Map(strategy.portfolioRules.map((rule) => [rule.type, rule]));
  const driftRule = rulesByType.get(PortfolioRuleType.MIN_REBALANCE_DRIFT);

  return {
    id: strategy.id,
    name: strategy.name,
    objective: strategy.objective,
    baseCurrency: strategy.baseCurrency,
    updatedAt: strategy.updatedAt.toISOString(),
    allocations: [...strategy.allocations]
      .sort((left, right) => assetClassOrder(left.assetClass) - assetClassOrder(right.assetClass))
      .map((allocation) => ({
        assetClass: allocation.assetClass,
        targetPercent: serializeDecimal(allocation.targetPercent),
        minPercent: serializeDecimal(allocation.minPercent),
        maxPercent: serializeDecimal(allocation.maxPercent),
        assetTargets: [...allocation.assetAllocations]
          .sort((left, right) => left.asset.symbol.localeCompare(right.asset.symbol))
          .map((assetAllocation) => ({
            assetId: assetAllocation.assetId,
            symbol: assetAllocation.asset.symbol,
            name: assetAllocation.asset.name,
            targetPercent: serializeDecimal(assetAllocation.targetPercent),
          })),
      })),
    availableAssets: [...availableAssets]
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .map((asset) => ({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.assetClass,
      })),
    rules: {
      preferContributionsOverSelling:
        rulesByType.get(PortfolioRuleType.PREFER_CONTRIBUTIONS_OVER_SELLING)?.enabled ?? true,
      challengeStrategyViolations:
        rulesByType.get(PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS)?.enabled ?? true,
      preferNoActionWhenEvidenceWeak:
        rulesByType.get(PortfolioRuleType.PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK)?.enabled ?? true,
      minimumRebalanceDrift: readConfigString(driftRule?.config, "minDriftPercent") ?? "2",
      singleAssetLimitEnabled: rulesByType.get(PortfolioRuleType.SINGLE_ASSET_MAX_ALLOCATION)?.enabled ?? false,
      singleAssetMaxPercent: readConfigString(rulesByType.get(PortfolioRuleType.SINGLE_ASSET_MAX_ALLOCATION)?.config, "maxPercent") ?? "100",
      custodianLimitEnabled: rulesByType.get(PortfolioRuleType.CUSTODIAN_MAX_ALLOCATION)?.enabled ?? false,
      custodianMaxPercent: readConfigString(rulesByType.get(PortfolioRuleType.CUSTODIAN_MAX_ALLOCATION)?.config, "maxPercent") ?? "100",
    },
  };
}

function readConfigString(config: unknown, key: string) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export function assetClassLabel(assetClass: AssetClass) {
  if (assetClass === AssetClass.CRYPTO) return "Crypto";
  if (assetClass === AssetClass.GOLD) return "Gold";
  if (assetClass === AssetClass.CASH) return "Cash";
  return assetClass;
}
