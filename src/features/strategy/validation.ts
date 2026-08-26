import { z } from "zod";
import { AssetClass, PortfolioRuleType } from "@/lib/domain/enums";

export const editableAssetClasses = [
  AssetClass.ETF,
  AssetClass.CRYPTO,
  AssetClass.GOLD,
  AssetClass.CASH,
  AssetClass.OTHER,
] as const;

const decimalLikeSchema = z.union([z.string(), z.number()]).transform((value) => String(value).trim());

export const strategyAssetAllocationInputSchema = z.object({
  assetId: z.string().trim().min(1),
  targetPercent: decimalLikeSchema,
});

export const strategyAllocationInputSchema = z.object({
  assetClass: z.enum(AssetClass),
  targetPercent: decimalLikeSchema,
  minPercent: decimalLikeSchema,
  maxPercent: decimalLikeSchema,
  assetTargets: z.array(strategyAssetAllocationInputSchema).min(1, "Each active class needs at least one asset target."),
});

export const strategyInputSchema = z.object({
  name: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  baseCurrency: z.string().trim().min(3).max(12),
  allocations: z.array(strategyAllocationInputSchema).min(1),
});

export const strategyRulesInputSchema = z.object({
  preferContributionsOverSelling: z.boolean(),
  challengeStrategyViolations: z.boolean(),
  preferNoActionWhenEvidenceWeak: z.boolean(),
  minimumRebalanceDrift: decimalLikeSchema,
});

export const updateStrategyInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Strategy name is required."),
  allocations: z.array(strategyAllocationInputSchema),
  rules: strategyRulesInputSchema,
});

export const portfolioRuleInputSchema = z.object({
  type: z.enum(PortfolioRuleType),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()),
});

export type StrategyAllocationInput = z.infer<typeof strategyAllocationInputSchema>;
export type StrategyAssetAllocationInput = z.infer<typeof strategyAssetAllocationInputSchema>;
export type StrategyInput = z.infer<typeof strategyInputSchema>;
export type PortfolioRuleInput = z.infer<typeof portfolioRuleInputSchema>;
export type UpdateStrategyInput = z.input<typeof updateStrategyInputSchema>;
export type ParsedUpdateStrategyInput = z.infer<typeof updateStrategyInputSchema>;

export type StrategyDraftAnalysis = {
  isValid: boolean;
  totalBasisPoints: number;
  totalPercent: string;
  errors: string[];
};

export class StrategyAllocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyAllocationValidationError";
  }
}

export function parsePercentToBasisPoints(value: string | number) {
  const normalized = String(value).trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new StrategyAllocationValidationError("Percentages must have at most two decimal places.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  if (!Number.isSafeInteger(basisPoints)) {
    throw new StrategyAllocationValidationError("Allocation percentages must be valid numbers.");
  }

  return basisPoints;
}

export function formatBasisPoints(basisPoints: number) {
  return (basisPoints / 100).toFixed(2);
}

export function analyzeStrategyDraft(input: {
  name: string;
  allocations: StrategyAllocationInput[];
  minimumRebalanceDrift: string | number;
}): StrategyDraftAnalysis {
  const errors: string[] = [];
  const classCounts = new Map<AssetClass, number>();
  let totalBasisPoints = 0;

  if (!input.name.trim()) {
    errors.push("Strategy name is required.");
  }

  for (const allocation of input.allocations) {
    classCounts.set(allocation.assetClass, (classCounts.get(allocation.assetClass) ?? 0) + 1);

    try {
      const min = parsePercentToBasisPoints(allocation.minPercent);
      const target = parsePercentToBasisPoints(allocation.targetPercent);
      const max = parsePercentToBasisPoints(allocation.maxPercent);

      if (min < 0 || max > 10_000) {
        errors.push(`${allocation.assetClass} percentages must be between 0 and 100.`);
      } else if (min > target || target > max) {
        errors.push(`${allocation.assetClass} must satisfy minimum ≤ target ≤ maximum.`);
      }

      totalBasisPoints += target;
    } catch (error) {
      errors.push(error instanceof Error ? `${allocation.assetClass}: ${error.message}` : `${allocation.assetClass} is invalid.`);
    }

    const assetCounts = new Map<string, number>();
    let assetTargetTotal = 0;
    if (allocation.assetTargets.length === 0) {
      errors.push(`${allocation.assetClass} must contain at least one asset target.`);
    }
    for (const assetTarget of allocation.assetTargets) {
      assetCounts.set(assetTarget.assetId, (assetCounts.get(assetTarget.assetId) ?? 0) + 1);
      try {
        const target = parsePercentToBasisPoints(assetTarget.targetPercent);
        if (target < 0 || target > 10_000) {
          errors.push(`${allocation.assetClass} asset target percentages must be between 0 and 100.`);
        }
        assetTargetTotal += target;
      } catch (error) {
        errors.push(error instanceof Error ? `${allocation.assetClass} asset target: ${error.message}` : `${allocation.assetClass} asset target is invalid.`);
      }
    }
    if (assetTargetTotal !== 10_000) {
      errors.push(`${allocation.assetClass} asset targets must total exactly 100.00%.`);
    }
    for (const count of assetCounts.values()) {
      if (count > 1) {
        errors.push(`${allocation.assetClass} asset targets must not contain duplicate assets.`);
        break;
      }
    }
  }

  if ([...classCounts.keys()].some((assetClass) => !editableAssetClasses.includes(assetClass as (typeof editableAssetClasses)[number]))) {
    errors.push("Only supported asset classes are editable.");
  }

  for (const [assetClass, count] of classCounts) {
    if (count > 1) {
      errors.push(`Strategy must contain only one ${assetClass} allocation.`);
    }
  }

  if (totalBasisPoints !== 10_000) {
    errors.push("Strategy target allocations must total exactly 100.00%.");
  }

  try {
    const drift = parsePercentToBasisPoints(input.minimumRebalanceDrift);
    if (drift < 0 || drift > 10_000) {
      errors.push("Minimum rebalance drift must be between 0 and 100.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Minimum rebalance drift is invalid.");
  }

  return {
    isValid: errors.length === 0,
    totalBasisPoints,
    totalPercent: formatBasisPoints(totalBasisPoints),
    errors: [...new Set(errors)],
  };
}

export function validateStrategyAllocations(allocations: StrategyAllocationInput[]) {
  const parsed = z.array(strategyAllocationInputSchema).min(1).parse(allocations);
  const analysis = analyzeStrategyDraft({
    name: "Existing strategy",
    allocations: parsed,
    minimumRebalanceDrift: "0",
  });

  if (!analysis.isValid) {
    throw new StrategyAllocationValidationError(analysis.errors[0]);
  }

  return parsed;
}

export function validateUpdateStrategyInput(input: UpdateStrategyInput) {
  const parsed = updateStrategyInputSchema.parse(input);
  const analysis = analyzeStrategyDraft({
    name: parsed.name,
    allocations: parsed.allocations,
    minimumRebalanceDrift: parsed.rules.minimumRebalanceDrift,
  });

  if (!analysis.isValid) {
    throw new StrategyAllocationValidationError(analysis.errors[0]);
  }

  return parsed;
}

export function strategyDraftFingerprint(input: {
  name: string;
  allocations: StrategyAllocationInput[];
  rules: z.infer<typeof strategyRulesInputSchema>;
}) {
  return JSON.stringify({
    name: input.name,
    allocations: [...input.allocations]
      .sort((left, right) => assetClassOrder(left.assetClass) - assetClassOrder(right.assetClass))
      .map((allocation) => ({
        assetClass: allocation.assetClass,
        targetPercent: fingerprintPercent(allocation.targetPercent),
        minPercent: fingerprintPercent(allocation.minPercent),
        maxPercent: fingerprintPercent(allocation.maxPercent),
        assetTargets: [...allocation.assetTargets]
          .sort((left, right) => left.assetId.localeCompare(right.assetId))
          .map((assetTarget) => ({
            assetId: assetTarget.assetId,
            targetPercent: fingerprintPercent(assetTarget.targetPercent),
          })),
      })),
    rules: {
      ...input.rules,
      minimumRebalanceDrift: fingerprintPercent(input.rules.minimumRebalanceDrift),
    },
  });
}

export function assetClassOrder(assetClass: AssetClass) {
  const index = editableAssetClasses.indexOf(assetClass as (typeof editableAssetClasses)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function fingerprintPercent(value: string | number) {
  try {
    return parsePercentToBasisPoints(value);
  } catch {
    return String(value);
  }
}
