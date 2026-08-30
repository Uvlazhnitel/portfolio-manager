import type { Prisma } from "@prisma/client";
import {
  validateStrategyAllocations,
  validateUpdateStrategyInput,
  type StrategyInput,
  type UpdateStrategyInput,
} from "@/features/strategy/validation";
import { serializeDecimal } from "@/lib/db/decimal";
import { StrategyRepository } from "@/features/strategy/repository";

export class StrategyService {
  constructor(private readonly repository = new StrategyRepository()) {}

  getActiveStrategy() {
    return this.repository.findActiveStrategy();
  }

  createStrategy(input: StrategyInput) {
    const allocations = validateStrategyAllocations(input.allocations);

    return this.repository.createStrategy({
      name: input.name,
      objective: input.objective,
      baseCurrency: input.baseCurrency,
      allocations: {
        create: allocations.map((allocation) => ({
          assetClass: allocation.assetClass,
          targetPercent: allocation.targetPercent,
          minPercent: allocation.minPercent,
          maxPercent: allocation.maxPercent,
          ...(allocation.assetTargets.length > 0 ? {
            assetAllocations: {
              create: allocation.assetTargets.map((assetTarget) => ({
                assetId: assetTarget.assetId,
                targetPercent: assetTarget.targetPercent,
              })),
            },
          } : {}),
        })),
      },
    });
  }

  async updateStrategy(input: UpdateStrategyInput) {
    const parsed = validateUpdateStrategyInput(input);
    return await this.repository.updateStrategy(parsed);
  }

  updateBenchmark(strategyId: string, benchmarkAssetId: string | null) {
    if (!strategyId.trim()) throw new Error("Strategy is required.");
    return this.repository.updateBenchmark(strategyId, benchmarkAssetId?.trim() || null);
  }
}

export function serializeStrategyAllocation(allocation: {
  targetPercent: Prisma.Decimal;
  minPercent: Prisma.Decimal;
  maxPercent: Prisma.Decimal;
}) {
  return {
    ...allocation,
    targetPercent: serializeDecimal(allocation.targetPercent),
    minPercent: serializeDecimal(allocation.minPercent),
    maxPercent: serializeDecimal(allocation.maxPercent),
  };
}
