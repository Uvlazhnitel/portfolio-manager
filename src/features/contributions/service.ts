import { AssetClass, type Prisma } from "@prisma/client";
import { ContributionPlanRepository } from "@/features/contributions/repository";
import { parseSaveInput, validateContributionAllocations, type SaveContributionPlanInput } from "@/features/contributions/validation";
import { StrategyRepository } from "@/features/strategy/repository";

export class ContributionPlanService {
  constructor(
    private readonly repository = new ContributionPlanRepository(),
    private readonly strategyRepository = new StrategyRepository(),
  ) {}

  async save(input: SaveContributionPlanInput) {
    const parsed = parseSaveInput(input);
    const strategy = await this.strategyRepository.findActiveStrategy();
    if (!strategy || strategy.id !== parsed.strategyId) {
      throw new Error("Active strategy was not found.");
    }
    if (strategy.baseCurrency !== parsed.currency) {
      throw new Error(`Contribution currency must match strategy base currency ${strategy.baseCurrency}.`);
    }
    validateContributionAllocations(
      parsed.contributionAmount,
      parsed.allocations,
      strategy.allocations.map((allocation) => allocation.assetClass),
    );

    const allocations = parsed.allocations
      .sort((left, right) => contributionClassOrder(left.assetClass) - contributionClassOrder(right.assetClass))
      .map((allocation) => ({ assetClass: allocation.assetClass, amount: allocation.amount }));

    return this.repository.upsert({
      strategyId: parsed.strategyId,
      contributionAmount: parsed.contributionAmount,
      currency: parsed.currency,
      allocations: allocations as Prisma.InputJsonValue,
      isCustomized: parsed.isCustomized,
    });
  }
}

function contributionClassOrder(assetClass: AssetClass) {
  const order: Record<AssetClass, number> = {
    [AssetClass.ETF]: 0,
    [AssetClass.CRYPTO]: 1,
    [AssetClass.GOLD]: 2,
    [AssetClass.CASH]: 3,
    [AssetClass.OTHER]: 4,
  };
  return order[assetClass];
}
