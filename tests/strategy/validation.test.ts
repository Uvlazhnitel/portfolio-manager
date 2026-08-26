import { AssetClass } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  analyzeStrategyDraft,
  parsePercentToBasisPoints,
  strategyDraftFingerprint,
  StrategyAllocationValidationError,
  validateUpdateStrategyInput,
  validateStrategyAllocations,
} from "@/features/strategy/validation";

const validAllocations = [
  allocation(AssetClass.ETF, "77", "72", "82", [["etf", "100"]]),
  allocation(AssetClass.CRYPTO, "12", "8", "15", [["btc", "70"], ["eth", "30"]]),
  allocation(AssetClass.GOLD, "9", "7", "15", [["gold", "60"], ["xaut", "40"]]),
  allocation(AssetClass.CASH, "2", "0", "5", [["eur", "50"], ["usdt", "50"]]),
];

function allocation(
  assetClass: AssetClass,
  targetPercent: string,
  minPercent: string,
  maxPercent: string,
  targets: Array<[string, string]>,
) {
  return {
    assetClass,
    targetPercent,
    minPercent,
    maxPercent,
    assetTargets: targets.map(([assetId, targetPercent]) => ({ assetId, targetPercent })),
  };
}

describe("strategy allocation validation", () => {
  it("accepts allocations that total 100", () => {
    expect(validateStrategyAllocations(validAllocations)).toHaveLength(4);
  });

  it("accepts a strategy without CASH", () => {
    const withoutCash = [
      { assetClass: AssetClass.ETF, targetPercent: "78", minPercent: "70", maxPercent: "85" },
      { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "20" },
      { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15" },
    ].map((row) => allocation(row.assetClass, row.targetPercent, row.minPercent, row.maxPercent, [[row.assetClass.toLowerCase(), "100"]]));

    expect(validateStrategyAllocations(withoutCash)).toHaveLength(3);
  });

  it("rejects asset targets that do not total 100 within a class", () => {
    expect(() => validateStrategyAllocations([
      { ...validAllocations[0], assetTargets: [{ assetId: "etf", targetPercent: "99" }] },
    ])).toThrow(StrategyAllocationValidationError);
  });

  it("accepts any 3 enabled classes totaling 100", () => {
    expect(validateStrategyAllocations([
      allocation(AssetClass.ETF, "60", "50", "70", [["etf", "100"]]),
      allocation(AssetClass.GOLD, "25", "15", "35", [["gold", "100"]]),
      allocation(AssetClass.CASH, "15", "0", "25", [["eur", "100"]]),
    ])).toHaveLength(3);
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
      ].map((row) => allocation(row.assetClass, row.targetPercent, row.minPercent, row.maxPercent, [[row.assetClass.toLowerCase(), "100"]]))),
    ).toThrow(StrategyAllocationValidationError);
  });

  it("rejects allocations where target is outside the allowed range", () => {
    expect(() =>
      validateStrategyAllocations([
        allocation(AssetClass.ETF, "77", "80", "82", [["etf", "100"]]),
        allocation(AssetClass.CRYPTO, "12", "8", "15", [["btc", "100"]]),
        allocation(AssetClass.GOLD, "9", "7", "15", [["gold", "100"]]),
        allocation(AssetClass.CASH, "2", "0", "5", [["eur", "100"]]),
      ]),
    ).toThrow(StrategyAllocationValidationError);
  });

  it("uses exact integer basis points for decimal totals", () => {
    const allocations = [
      { assetClass: AssetClass.ETF, targetPercent: "77.01", minPercent: "70", maxPercent: "82" },
      { assetClass: AssetClass.CRYPTO, targetPercent: "11.99", minPercent: "8", maxPercent: "15" },
      { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
      { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
    ].map((row) => allocation(row.assetClass, row.targetPercent, row.minPercent, row.maxPercent, [[row.assetClass.toLowerCase(), "100"]]));

    expect(validateStrategyAllocations(allocations)).toHaveLength(4);
    expect(parsePercentToBasisPoints("77.01")).toBe(7701);
  });

  it("accepts inclusive 0 and 100 boundaries", () => {
    expect(validateStrategyAllocations([
      allocation(AssetClass.ETF, "100", "0", "100", [["etf", "100"]]),
    ])).toHaveLength(1);
  });

  it("rejects values outside 0-100 and precision beyond two decimals", () => {
    const overMaximum = validAllocations.map((allocation) =>
      allocation.assetClass === AssetClass.ETF ? { ...allocation, maxPercent: "100.01" } : allocation,
    );
    const excessivePrecision = validAllocations.map((allocation) =>
      allocation.assetClass === AssetClass.ETF ? { ...allocation, targetPercent: "77.001" } : allocation,
    );

    expect(() => validateStrategyAllocations(overMaximum)).toThrow(StrategyAllocationValidationError);
    expect(() => validateStrategyAllocations(excessivePrecision)).toThrow(StrategyAllocationValidationError);
    expect(() => parsePercentToBasisPoints("-1")).toThrow(StrategyAllocationValidationError);
  });

  it("rejects duplicate enabled classes", () => {
    const duplicate = validAllocations.map((allocation, index) =>
      index === 3 ? { ...allocation, assetClass: AssetClass.GOLD } : allocation,
    );
    expect(() => validateStrategyAllocations(duplicate)).toThrow(StrategyAllocationValidationError);
  });

  it("validates name and minimum drift", () => {
    const base = {
      id: "strategy",
      name: "Long-term growth",
      allocations: validAllocations,
      rules: {
        preferContributionsOverSelling: true,
        challengeStrategyViolations: true,
        preferNoActionWhenEvidenceWeak: true,
        minimumRebalanceDrift: "2",
      },
    };

    expect(validateUpdateStrategyInput(base).rules.minimumRebalanceDrift).toBe("2");
    expect(() => validateUpdateStrategyInput({ ...base, name: " " })).toThrow();
    expect(() => validateUpdateStrategyInput({ ...base, rules: { ...base.rules, minimumRebalanceDrift: "101" } })).toThrow(StrategyAllocationValidationError);
  });

  it("reports live total errors and treats equivalent decimal formatting as saved", () => {
    const invalid = analyzeStrategyDraft({
      name: "Strategy",
      allocations: validAllocations.map((allocation, index) => index === 0 ? { ...allocation, targetPercent: "76" } : allocation),
      minimumRebalanceDrift: "2",
    });
    const draft = {
      name: "Strategy",
      allocations: validAllocations,
      rules: {
        preferContributionsOverSelling: true,
        challengeStrategyViolations: true,
        preferNoActionWhenEvidenceWeak: true,
        minimumRebalanceDrift: "2",
      },
    };
    const equivalent = {
      ...draft,
      allocations: draft.allocations.map((allocation) => ({
        ...allocation,
        targetPercent: `${Number(allocation.targetPercent).toFixed(2)}`,
      })),
      rules: { ...draft.rules, minimumRebalanceDrift: "2.00" },
    };

    expect(invalid.isValid).toBe(false);
    expect(invalid.totalPercent).toBe("99.00");
    expect(strategyDraftFingerprint(draft)).toBe(strategyDraftFingerprint(equivalent));
  });
});
