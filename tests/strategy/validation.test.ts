import { AssetClass } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  StrategyAllocationValidationError,
  validateStrategyAllocations,
} from "@/features/strategy/validation";

const validAllocations = [
  { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "72", maxPercent: "82" },
  { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
  { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
  { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
];

describe("strategy allocation validation", () => {
  it("accepts allocations that total 100", () => {
    expect(validateStrategyAllocations(validAllocations)).toHaveLength(4);
  });

  it("accepts allocations where min <= target <= max", () => {
    const result = validateStrategyAllocations(validAllocations);
    expect(result.every((allocation) => Number(allocation.minPercent) <= Number(allocation.targetPercent))).toBe(true);
    expect(result.every((allocation) => Number(allocation.targetPercent) <= Number(allocation.maxPercent))).toBe(true);
  });

  it("rejects allocations that do not total 100", () => {
    expect(() =>
      validateStrategyAllocations([
        { assetClass: AssetClass.ETF, targetPercent: "80", minPercent: "72", maxPercent: "82" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
        { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
        { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
      ]),
    ).toThrow(StrategyAllocationValidationError);
  });

  it("rejects allocations where target is outside the allowed range", () => {
    expect(() =>
      validateStrategyAllocations([
        { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "80", maxPercent: "82" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
        { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
        { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
      ]),
    ).toThrow(StrategyAllocationValidationError);
  });
});
