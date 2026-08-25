import { AssetClass, PortfolioRuleType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StrategyRepository } from "@/features/strategy/repository";
import { StrategyService } from "@/features/strategy/service";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

let testDb: TestDatabase;
let strategyId: string;

const allocations = [
  { assetClass: AssetClass.ETF, targetPercent: "77", minPercent: "72", maxPercent: "82" },
  { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "15" },
  { assetClass: AssetClass.GOLD, targetPercent: "9", minPercent: "7", maxPercent: "15" },
  { assetClass: AssetClass.CASH, targetPercent: "2", minPercent: "0", maxPercent: "5" },
];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const strategy = await testDb.prisma.strategy.create({
    data: {
      name: "Original",
      objective: "Long-term growth",
      baseCurrency: "EUR",
      allocations: { create: allocations },
      portfolioRules: {
        create: [
          { type: PortfolioRuleType.CRYPTO_MAX_ALLOCATION, enabled: true, config: { maxPercent: "15" } },
          { type: PortfolioRuleType.MIN_REBALANCE_DRIFT, enabled: true, config: { minDriftPercent: "5" } },
        ],
      },
    },
  });
  strategyId = strategy.id;
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("strategy update", () => {
  it("atomically persists allocations and normalized portfolio rules", async () => {
    const service = new StrategyService(new StrategyRepository(testDb.prisma));
    const updated = await service.updateStrategy({
      id: strategyId,
      name: "Long-term capital growth",
      allocations: allocations.map((allocation) =>
        allocation.assetClass === AssetClass.CRYPTO
          ? { ...allocation, maxPercent: "14" }
          : allocation,
      ),
      rules: {
        preferContributionsOverSelling: true,
        challengeStrategyViolations: false,
        preferNoActionWhenEvidenceWeak: true,
        minimumRebalanceDrift: "2.25",
      },
    });

    expect(updated.name).toBe("Long-term capital growth");
    expect(updated.allocations.find((allocation) => allocation.assetClass === AssetClass.CRYPTO)?.maxPercent.toString()).toBe("14");
    expect(updated.portfolioRules.find((rule) => rule.type === PortfolioRuleType.CRYPTO_MAX_ALLOCATION)).toBeUndefined();
    expect(updated.portfolioRules.find((rule) => rule.type === PortfolioRuleType.CHALLENGE_STRATEGY_VIOLATIONS)?.enabled).toBe(false);
    expect(updated.portfolioRules.find((rule) => rule.type === PortfolioRuleType.PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK)?.enabled).toBe(true);
    expect(updated.portfolioRules.find((rule) => rule.type === PortfolioRuleType.MIN_REBALANCE_DRIFT)?.config).toEqual({ minDriftPercent: "2.25" });
  });

  it("rejects invalid input without partially updating the strategy", async () => {
    const service = new StrategyService(new StrategyRepository(testDb.prisma));
    const before = await testDb.prisma.strategy.findUniqueOrThrow({
      where: { id: strategyId },
      include: { allocations: true },
    });

    await expect(service.updateStrategy({
      id: strategyId,
      name: "Must not persist",
      allocations: allocations.map((allocation) =>
        allocation.assetClass === AssetClass.ETF
          ? { ...allocation, targetPercent: "78" }
          : allocation,
      ),
      rules: {
        preferContributionsOverSelling: false,
        challengeStrategyViolations: false,
        preferNoActionWhenEvidenceWeak: false,
        minimumRebalanceDrift: "2",
      },
    })).rejects.toThrow("total exactly 100.00%");

    const after = await testDb.prisma.strategy.findUniqueOrThrow({
      where: { id: strategyId },
      include: { allocations: true },
    });
    expect(after.name).toBe(before.name);
    expect(after.allocations.map((allocation) => allocation.targetPercent.toString()).sort())
      .toEqual(before.allocations.map((allocation) => allocation.targetPercent.toString()).sort());
  });

  it("removes a disabled allocation and adds it back later", async () => {
    const service = new StrategyService(new StrategyRepository(testDb.prisma));

    const withoutCash = await service.updateStrategy({
      id: strategyId,
      name: "No cash sleeve",
      allocations: [
        { assetClass: AssetClass.ETF, targetPercent: "78", minPercent: "70", maxPercent: "85" },
        { assetClass: AssetClass.CRYPTO, targetPercent: "12", minPercent: "8", maxPercent: "20" },
        { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15" },
      ],
      rules: {
        preferContributionsOverSelling: true,
        challengeStrategyViolations: true,
        preferNoActionWhenEvidenceWeak: true,
        minimumRebalanceDrift: "2",
      },
    });

    expect(withoutCash.allocations.map((allocation) => allocation.assetClass).sort()).toEqual([
      AssetClass.CRYPTO,
      AssetClass.ETF,
      AssetClass.GOLD,
    ].sort());

    const withCashAgain = await service.updateStrategy({
      id: strategyId,
      name: "Cash sleeve restored",
      allocations,
      rules: {
        preferContributionsOverSelling: true,
        challengeStrategyViolations: true,
        preferNoActionWhenEvidenceWeak: true,
        minimumRebalanceDrift: "2",
      },
    });

    expect(withCashAgain.allocations).toHaveLength(4);
    expect(withCashAgain.allocations.some((allocation) => allocation.assetClass === AssetClass.CASH)).toBe(true);
  });
});
