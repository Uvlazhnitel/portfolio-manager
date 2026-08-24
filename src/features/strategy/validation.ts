import { AssetClass, PortfolioRuleType } from "@prisma/client";
import { z } from "zod";

const decimalLikeSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

export const strategyAllocationInputSchema = z.object({
  assetClass: z.enum(AssetClass),
  targetPercent: decimalLikeSchema,
  minPercent: decimalLikeSchema,
  maxPercent: decimalLikeSchema,
});

export const strategyInputSchema = z.object({
  name: z.string().min(1),
  objective: z.string().min(1),
  baseCurrency: z.string().min(3).max(12),
  allocations: z.array(strategyAllocationInputSchema).min(1),
});

export const portfolioRuleInputSchema = z.object({
  type: z.enum(PortfolioRuleType),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()),
});

export type StrategyAllocationInput = z.infer<typeof strategyAllocationInputSchema>;
export type StrategyInput = z.infer<typeof strategyInputSchema>;
export type PortfolioRuleInput = z.infer<typeof portfolioRuleInputSchema>;

export class StrategyAllocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyAllocationValidationError";
  }
}

export function validateStrategyAllocations(allocations: StrategyAllocationInput[]) {
  const parsed = z.array(strategyAllocationInputSchema).min(1).parse(allocations);
  let targetTotal = 0;

  for (const allocation of parsed) {
    const target = Number(allocation.targetPercent);
    const min = Number(allocation.minPercent);
    const max = Number(allocation.maxPercent);

    if (!Number.isFinite(target) || !Number.isFinite(min) || !Number.isFinite(max)) {
      throw new StrategyAllocationValidationError("Allocation percentages must be valid numbers.");
    }

    if (min > target || target > max) {
      throw new StrategyAllocationValidationError(
        `${allocation.assetClass} must satisfy minPercent <= targetPercent <= maxPercent.`,
      );
    }

    targetTotal += target;
  }

  if (Math.abs(targetTotal - 100) > 0.000001) {
    throw new StrategyAllocationValidationError("Strategy target allocations must total 100%.");
  }

  return parsed;
}
