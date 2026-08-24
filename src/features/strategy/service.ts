import type { Prisma } from "@prisma/client";
import { validateStrategyAllocations, type StrategyInput } from "@/features/strategy/validation";
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
        })),
      },
    });
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
