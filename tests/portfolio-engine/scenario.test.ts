import { AccountType, AssetClass, AssetType, BasisMethod, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculatePortfolioScenario, type CalculatePortfolioScenarioInput } from "@/features/portfolio-engine";

const input: CalculatePortfolioScenarioInput = {
  assets: [
    { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    { id: "usd", symbol: "USD", name: "US Dollar", assetClass: AssetClass.CASH, assetType: AssetType.FIAT, currency: "USD" },
  ],
  accounts: [{ id: "exchange", name: "Exchange", type: AccountType.EXCHANGE, custodian: { id: "bybit", name: "Bybit", category: "EXCHANGE" } }],
  transactions: [
    { accountId: "exchange", assetId: "btc", type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "1", pricePerUnit: "100", currency: "USD" },
    { accountId: "exchange", assetId: "usd", type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "900", pricePerUnit: "1", currency: "USD" },
  ],
  marketPrices: { BTC: "100", USD: "1" },
  strategy: [
    { assetClass: AssetClass.CRYPTO, targetPercent: "10", minPercent: "0", maxPercent: "20" },
    { assetClass: AssetClass.CASH, targetPercent: "90", minPercent: "80", maxPercent: "100" },
  ],
  riskThresholds: { singleAssetMaxPercent: "95", custodianMaxPercent: null },
  hasStalePrices: false,
  baseCurrency: "USD",
  accountId: "exchange",
  assetId: "btc",
  kind: "BUY",
  amount: "500",
};

describe("portfolio scenario engine", () => {
  it("returns deterministic before/after strategy and risk snapshots", () => {
    const result = calculatePortfolioScenario(input);

    expect(result.current.totalValue).toBe("1000.00");
    expect(result.projected.totalValue).toBe("1500.00");
    expect(result.newWarnings).toContainEqual(expect.objectContaining({ source: "STRATEGY", code: "CRYPTO_ABOVE_MAX" }));
    expect(result.projectedRisk.cryptoAllocation.valuePercent).toBe("40.00");
    expect(result.maximumCompliantAmount).toBe("125.00");
    expect(result.remainingAmount).toBe("375.00");
  });

  it("distinguishes external contributions and validates account-specific sells", () => {
    const contribution = calculatePortfolioScenario({ ...input, kind: "CONTRIBUTION", amount: "50" });
    expect(contribution.reasonCodes).toContain("EXTERNAL_CONTRIBUTION");
    expect(contribution.projected.totalValue).toBe("1050.00");

    expect(() => calculatePortfolioScenario({ ...input, kind: "SELL", amount: "100.01" }))
      .toThrow("selected account");
  });

  it("preserves partial and stale states without calculating an alternative", () => {
    const partial = calculatePortfolioScenario({
      ...input,
      hasStalePrices: true,
      assets: [...input.assets, { id: "gold", symbol: "GOLD", assetClass: AssetClass.GOLD, assetType: AssetType.OTHER }],
      transactions: [...input.transactions, { accountId: "exchange", assetId: "gold", type: TransactionType.BUY, quantity: "1", pricePerUnit: "10", currency: "USD" }],
    });

    expect(partial.currentRisk.state).toBe("PARTIAL");
    expect(partial.projectedRisk.missingPriceSymbols).toContain("GOLD");
    expect(partial.reasonCodes).toEqual(expect.arrayContaining(["PARTIAL_VALUATION", "STALE_PRICE_DATA"]));
    expect(partial.maximumCompliantAmount).toBeNull();
  });
});
