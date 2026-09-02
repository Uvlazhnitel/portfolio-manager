import { AssetClass, type Prisma } from "@prisma/client";
import {
  buildContributionProjection,
  projectCustomContribution,
  type ContributionProjection,
  type EngineAsset,
  type EngineStrategyAllocation,
  type PortfolioSnapshot,
} from "@/features/portfolio-engine";
import { serializeDecimal } from "@/lib/db/decimal";

export type SavedContributionPlanInput = {
  contributionAmount: Prisma.Decimal;
  allocations: unknown;
  isCustomized: boolean;
};

export function buildSavedContributionProjection({
  portfolio,
  assets,
  strategy,
  savedPlan,
}: {
  portfolio: PortfolioSnapshot;
  assets: EngineAsset[];
  strategy: EngineStrategyAllocation[];
  savedPlan: SavedContributionPlanInput;
}): ContributionProjection {
  const contributionAmount = serializeDecimal(savedPlan.contributionAmount);

  if (!savedPlan.isCustomized) {
    return buildContributionProjection({ portfolio, assets, strategy, contributionAmount });
  }

  return projectCustomContribution({
    portfolio,
    assets,
    strategy,
    contributionAmount,
    allocations: parseSavedContributionAllocations(savedPlan.allocations),
  });
}

export function parseSavedContributionAllocations(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Saved contribution allocations are invalid.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Saved contribution allocations are invalid.");
    const row = item as Record<string, unknown>;
    return { assetClass: row.assetClass as AssetClass, amount: String(row.amount) };
  });
}
