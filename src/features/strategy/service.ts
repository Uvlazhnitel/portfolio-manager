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
    return this.repository.withTransaction(async (repository) => {
      const requestedAssetIds = [...new Set(
        parsed.allocations.flatMap((allocation) => allocation.assetTargets.map((target) => target.assetId)),
      )];
      const assets = await repository.findAssets(requestedAssetIds);
      const assetById = new Map(assets.map((asset) => [asset.id, asset]));

      for (const allocation of parsed.allocations) {
        for (const assetTarget of allocation.assetTargets) {
          const asset = assetById.get(assetTarget.assetId);
          if (!asset) throw new Error(`${allocation.assetClass} asset target references an unknown asset.`);
          if (asset.assetClass !== allocation.assetClass) {
            throw new Error(`${asset.symbol} must match parent ${allocation.assetClass} allocation.`);
          }
        }
      }

      return repository.updateStrategy(parsed);
    });
  }

  async updateBenchmark(strategyId: string, benchmarkAssetId: string | null) {
    if (!strategyId.trim()) throw new Error("Strategy is required.");
    const normalizedAssetId = benchmarkAssetId?.trim() || null;
    return this.repository.withTransaction(async (repository) => {
      if (normalizedAssetId && (await repository.findAssets([normalizedAssetId])).length === 0) {
        throw new Error("Benchmark asset does not exist.");
      }
      return repository.updateBenchmark(strategyId, normalizedAssetId);
    });
  }
}

export function serializeStrategyAllocation(allocation: {
  targetPercent: { toString(): string };
  minPercent: { toString(): string };
  maxPercent: { toString(): string };
}) {
  return {
    ...allocation,
    targetPercent: serializeDecimal(allocation.targetPercent),
    minPercent: serializeDecimal(allocation.minPercent),
    maxPercent: serializeDecimal(allocation.maxPercent),
  };
}
