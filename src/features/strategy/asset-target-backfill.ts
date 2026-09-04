import { AssetType, type Prisma } from "@prisma/client";
import { calculatePortfolio } from "@/features/portfolio-engine";
import { ZERO, decimal, toDecimalString } from "@/features/portfolio-engine/decimal";
import { StrategyRepository } from "@/features/strategy/repository";

export async function backfillStrategyAssetAllocations(repository: StrategyRepository) {
  const { strategies, assets, transactions, cachedPrices, manualPrices } =
    await repository.getAssetTargetBackfillSnapshot();

  if (strategies.length === 0) return;

  for (const strategy of strategies) {
    const marketPrices = new Map<string, Prisma.Decimal>();
    for (const asset of assets) {
      if (asset.assetType === AssetType.FIAT && asset.currency.toUpperCase() === strategy.baseCurrency.toUpperCase()) {
        marketPrices.set(asset.symbol, decimal(1));
      }
    }
    for (const price of cachedPrices.filter((price) => price.currency.toUpperCase() === strategy.baseCurrency.toUpperCase())) {
      const asset = assets.find((candidate) => candidate.id === price.assetId);
      if (asset) marketPrices.set(asset.symbol, price.price);
    }
    for (const price of manualPrices.filter((price) => price.currency.toUpperCase() === strategy.baseCurrency.toUpperCase())) {
      const asset = assets.find((candidate) => candidate.id === price.assetId);
      if (asset) marketPrices.set(asset.symbol, price.price);
    }

    const portfolio = calculatePortfolio({
      assets,
      transactions,
      marketPrices: Object.fromEntries([...marketPrices.entries()].map(([symbol, price]) => [symbol, price])),
    });
    const valueByAssetId = new Map<string, Prisma.Decimal>();
    for (const holding of portfolio.valuedHoldings) {
      valueByAssetId.set(holding.assetId, (valueByAssetId.get(holding.assetId) ?? ZERO).plus(decimal(holding.value)));
    }

    for (const allocation of strategy.allocations) {
      if (allocation.assetAllocations.length > 0) continue;

      const classAssets = assets.filter((asset) => asset.assetClass === allocation.assetClass);
      if (classAssets.length === 0) continue;

      const valuedAssets = classAssets
        .map((asset) => ({ asset, value: valueByAssetId.get(asset.id) ?? ZERO }))
        .filter((item) => item.value.greaterThan(ZERO));
      const targets = valuedAssets.length > 0
        ? percentageTargetsFromWeights(valuedAssets.map((item) => ({ assetId: item.asset.id, weight: item.value })))
        : evenPercentageTargets(classAssets.map((asset) => asset.id));

      await repository.createAssetTargets(
        targets.map((target) => ({
          strategyAllocationId: allocation.id,
          assetId: target.assetId,
          targetPercent: target.targetPercent,
        })),
      );
    }
  }
}

function evenPercentageTargets(assetIds: string[]) {
  if (assetIds.length === 0) return [];
  const base = Math.floor(10_000 / assetIds.length);
  let remainder = 10_000 - base * assetIds.length;
  return assetIds.map((assetId) => {
    const basisPoints = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return { assetId, targetPercent: formatBasisPoints(basisPoints) };
  });
}

function percentageTargetsFromWeights(input: Array<{ assetId: string; weight: Prisma.Decimal }>) {
  const totalWeight = input.reduce((sum, item) => sum.plus(item.weight), ZERO);
  if (totalWeight.equals(ZERO)) return evenPercentageTargets(input.map((item) => item.assetId));

  const rows = input.map((item) => {
    const rawBasisPoints = item.weight.div(totalWeight).mul(10_000);
    const floorBasisPoints = rawBasisPoints.floor();
    return {
      assetId: item.assetId,
      floorBasisPoints,
      fraction: rawBasisPoints.minus(floorBasisPoints),
    };
  });
  let allocated = rows.reduce((sum, row) => sum.plus(row.floorBasisPoints), ZERO);
  let remaining = decimal(10_000).minus(allocated);
  for (const row of rows.sort((left, right) => {
    const fractionCompare = decimal(right.fraction).cmp(decimal(left.fraction));
    return fractionCompare === 0 ? left.assetId.localeCompare(right.assetId) : fractionCompare;
  })) {
    if (remaining.lessThanOrEqualTo(ZERO)) break;
    row.floorBasisPoints = row.floorBasisPoints.plus(1);
    remaining = remaining.minus(1);
  }
  allocated = rows.reduce((sum, row) => sum.plus(row.floorBasisPoints), ZERO);
  const first = rows[0];
  if (first && !allocated.equals(10_000)) {
    first.floorBasisPoints = first.floorBasisPoints.plus(decimal(10_000).minus(allocated));
  }

  return rows.map((row) => ({
    assetId: row.assetId,
    targetPercent: toDecimalString(row.floorBasisPoints.div(100)),
  }));
}

function formatBasisPoints(basisPoints: number) {
  return (basisPoints / 100).toFixed(2);
}
