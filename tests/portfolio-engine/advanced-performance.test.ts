import { AssetClass, AssetType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateAdvancedPerformance,
  performanceRangeCutoff,
  type AdvancedPerformanceObservation,
  type CalculateAdvancedPerformanceInput,
  type EngineAsset,
  type EngineTransaction,
} from "@/features/portfolio-engine";

const usd: EngineAsset = {
  id: "usd",
  symbol: "USD",
  name: "US Dollar",
  assetClass: AssetClass.CASH,
  assetType: AssetType.FIAT,
  currency: "USD",
};

describe("advanced performance engine", () => {
  it("chains TWR without external cashflows", () => {
    const result = calculateAdvancedPerformance(input([
      point("2025-12-31", "100"),
      point("2026-01-01", "110"),
    ], point("2026-01-02", "121"), "2026-01-02T12:00:00Z"));

    expect(result.twr.value).toBe("21.00");
    expect(result.twr.unavailableReason).toBeNull();
  });

  it("removes contributions and withdrawals from TWR", () => {
    const contribution = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
    ], point("2026-01-02", "165", "50", "0"), "2026-01-02T12:00:00Z"));
    const withdrawal = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
    ], point("2026-01-02", "88", "0", "20"), "2026-01-02T12:00:00Z"));

    expect(contribution.twr.value).toBe("15.00");
    expect(withdrawal.twr.value).toBe("8.00");
  });

  it("returns unavailable rather than skipping partial valuation or cashflow history", () => {
    const incompleteValue = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
      { ...point("2026-01-02", null), isComplete: false },
    ], point("2026-01-03", "120"), "2026-01-03T12:00:00Z"));
    const incompleteCashflow = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
      { ...point("2026-01-02", "110"), externalContributions: null },
    ], point("2026-01-03", "120"), "2026-01-03T12:00:00Z"));

    expect(incompleteValue.twr.unavailableReason).toBe("INCOMPLETE_VALUATION");
    expect(incompleteCashflow.twr.unavailableReason).toBe("INCOMPLETE_EXTERNAL_CASHFLOWS");
  });

  it("uses fixed YTD and one-year boundaries, including leap-day clamping", () => {
    const ytd = calculateAdvancedPerformance(input([
      point("2025-12-31", "100"),
      point("2026-01-01", "110"),
    ], point("2026-06-30", "121"), "2026-06-30T12:00:00Z"));
    const oneYear = calculateAdvancedPerformance(input([
      point("2023-02-28", "100"),
      point("2023-03-01", "105"),
    ], point("2024-02-29", "120"), "2024-02-29T12:00:00Z"));

    expect(ytd.ytdReturn.value).toBe("21.00");
    expect(ytd.ytdReturn.startDate).toBe("2025-12-31");
    expect(oneYear.oneYearReturn.value).toBe("20.00");
    expect(oneYear.oneYearReturn.startDate).toBe("2023-02-28");
    expect(performanceRangeCutoff("2024-02-29", "1Y")).toBe("2023-02-28");
  });

  it("calculates drawdown from the cashflow-adjusted wealth index", () => {
    const drawdown = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
      point("2026-01-02", "120"),
    ], point("2026-01-03", "90"), "2026-01-03T12:00:00Z"));
    const depositOnly = calculateAdvancedPerformance(input([
      point("2026-01-01", "100"),
    ], point("2026-01-02", "150", "50"), "2026-01-02T12:00:00Z"));

    expect(drawdown.maxDrawdown.value).toBe("-25.00");
    expect(depositOnly.maxDrawdown.value).toBe("0.00");
  });

  it("normalizes portfolio and benchmark to a common 100 index", () => {
    const result = calculateAdvancedPerformance({
      ...input([point("2026-01-01", "100")], point("2026-01-02", "110"), "2026-01-02T12:00:00Z"),
      benchmark: {
        assetId: "benchmark",
        observations: [{ date: "2026-01-01", price: "50", hasStalePrices: false }],
        current: { date: "2026-01-02", price: "55", hasStalePrices: false },
      },
    });

    expect(result.comparisons.ALL.points).toEqual([
      expect.objectContaining({ date: "2026-01-01", portfolioIndex: "100.0000", benchmarkIndex: "100.0000" }),
      expect.objectContaining({ date: "2026-01-02", portfolioIndex: "110.0000", benchmarkIndex: "110.0000" }),
    ]);
  });

  it("reports missing benchmark coverage and stale comparison data", () => {
    const missing = calculateAdvancedPerformance(input(
      [point("2026-01-01", "100")],
      point("2026-01-02", "110"),
      "2026-01-02T12:00:00Z",
    ));
    const stale = calculateAdvancedPerformance({
      ...input([point("2026-01-01", "100")], point("2026-01-02", "110"), "2026-01-02T12:00:00Z"),
      benchmark: {
        assetId: "benchmark",
        observations: [{ date: "2026-01-01", price: "50", hasStalePrices: true }],
        current: { date: "2026-01-02", price: "55", hasStalePrices: false },
      },
    });

    expect(missing.comparisons.ALL.unavailableReason).toBe("BENCHMARK_NOT_CONFIGURED");
    expect(stale.comparisons.ALL.isStale).toBe(true);
  });

  it("calculates an annualized XIRR from the opening boundary and terminal value", () => {
    const result = calculateAdvancedPerformance(input(
      [point("2025-01-01", "100")],
      point("2026-01-01", "110"),
      "2026-01-01T12:00:00Z",
    ));

    expect(Number(result.xirr.value)).toBeCloseTo(10, 2);
  });

  it("uses dated external cashflows in XIRR and rejects unvalued flows", () => {
    const deposit: EngineTransaction = {
      assetId: "usd",
      accountId: "bank",
      type: TransactionType.DEPOSIT,
      quantity: "50",
      currency: "USD",
      executedAt: "2025-07-01T12:00:00Z",
    };
    const withCashflow = calculateAdvancedPerformance({
      ...input([point("2025-01-01", "100")], point("2026-01-01", "165", "50"), "2026-01-01T12:00:00Z"),
      transactions: [deposit],
    });
    const partial = calculateAdvancedPerformance({
      ...input([point("2025-01-01", "100")], point("2026-01-01", "165", "50"), "2026-01-01T12:00:00Z"),
      transactions: [{ ...deposit, currency: "EUR" }],
    });

    expect(withCashflow.xirr.value).not.toBeNull();
    expect(partial.xirr.unavailableReason).toBe("INCOMPLETE_EXTERNAL_CASHFLOWS");
  });

  it("returns clear XIRR reasons when no root or multiple roots exist", () => {
    const noRoot = calculateAdvancedPerformance(input(
      [point("2025-01-01", "100")],
      point("2026-01-01", "0"),
      "2026-01-01T12:00:00Z",
    ));
    const transactions: EngineTransaction[] = [
      { assetId: "usd", accountId: "bank", type: TransactionType.WITHDRAWAL, quantity: "230", currency: "USD", executedAt: "2026-01-01T12:00:00Z" },
      { assetId: "usd", accountId: "bank", type: TransactionType.DEPOSIT, quantity: "132", currency: "USD", executedAt: "2027-01-01T08:00:00Z" },
    ];
    const ambiguous = calculateAdvancedPerformance({
      ...input([point("2025-01-01", "100")], point("2027-01-01", "0", "132", "230"), "2027-01-01T12:00:00Z"),
      transactions,
    });

    expect(noRoot.xirr.unavailableReason).toBe("XIRR_NO_SOLUTION");
    expect(ambiguous.xirr.unavailableReason).toBe("XIRR_AMBIGUOUS_SOLUTION");
  });
});

function input(
  history: AdvancedPerformanceObservation[],
  current: AdvancedPerformanceObservation,
  asOf: string,
): CalculateAdvancedPerformanceInput {
  return {
    assets: [usd],
    transactions: [],
    baseCurrency: "USD",
    history,
    current,
    asOf,
    benchmark: null,
  };
}

function point(
  date: string,
  portfolioValue: string | null,
  externalContributions = "0",
  externalWithdrawals = "0",
): AdvancedPerformanceObservation {
  return {
    date,
    portfolioValue,
    externalContributions,
    externalWithdrawals,
    isComplete: portfolioValue !== null,
    hasStalePrices: false,
  };
}
