import { AssetClass, AssetType, FxRateSource, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateHoldingCostBasis, calculatePortfolioAnalytics, calculateTransactionCashValue, type EngineAsset, type EngineTransaction } from "@/features/portfolio-engine";

const vgla: EngineAsset = { id: "vgla", symbol: "VGLA", assetClass: AssetClass.ETF, assetType: AssetType.ETF, currency: "EUR" };

describe("multi-currency transaction accounting", () => {
  const eurBuy: EngineTransaction = {
    assetId: vgla.id,
    accountId: "broker",
    type: TransactionType.BUY,
    quantity: "10",
    pricePerUnit: "100",
    fee: "2",
    currency: "EUR",
    fxRateToBase: "1.2",
    fxRateSource: FxRateSource.MANUAL,
    fxRateDate: "2026-09-07",
    executedAt: "2026-09-07",
  };

  it("converts gross amounts and fees to the portfolio base currency", () => {
    expect(calculateTransactionCashValue(eurBuy, vgla, "USD")).toEqual(expect.objectContaining({
      gross: expect.objectContaining({ toString: expect.any(Function) }),
      fee: expect.objectContaining({ toString: expect.any(Function) }),
    }));
    const value = calculateTransactionCashValue(eurBuy, vgla, "USD")!;
    expect(value.gross.toString()).toBe("1200");
    expect(value.fee.toString()).toBe("2.4");
  });

  it("keeps cost basis and portfolio analytics available for an EUR VGLA purchase", () => {
    const basis = calculateHoldingCostBasis({ portfolio: { holdings: [{ assetId: vgla.id, accountId: "broker", quantity: "10" }], valuedHoldings: [], totalValue: "0", allocation: [], missingPriceSymbols: [] }, assets: [vgla], transactions: [eurBuy], baseCurrency: "USD" });
    expect(basis).toContainEqual(expect.objectContaining({ assetId: vgla.id, accountId: "broker", totalCost: "1202.40" }));

    const analytics = calculatePortfolioAnalytics({
      portfolio: { holdings: [{ assetId: vgla.id, accountId: "broker", quantity: "10" }], valuedHoldings: [{ assetId: vgla.id, accountId: "broker", quantity: "10", symbol: "VGLA", assetClass: AssetClass.ETF, assetType: AssetType.ETF, price: "130", value: "1300" }], totalValue: "1300", allocation: [{ assetClass: AssetClass.ETF, value: "1300", percentage: "100" }], missingPriceSymbols: [] },
      assets: [vgla],
      transactions: [eurBuy],
      baseCurrency: "USD",
    });
    expect(analytics.netInvested).toBe("1202.40");
    expect(analytics.investmentGain).toBe("97.60");
    expect(analytics.isCostBasisPartial).toBe(false);
  });

  it("keeps legacy unsupported foreign transactions partial when no rate was recorded", () => {
    expect(calculateTransactionCashValue({ ...eurBuy, fxRateToBase: null }, vgla, "USD")).toBeNull();
  });
});
