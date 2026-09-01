import { AccountType, AssetClass, AssetType, BasisMethod, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculatePortfolioScenario, IncompletePortfolioValuationError, type CalculatePortfolioScenarioInput } from "@/features/portfolio-engine";

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

const tradeInput: CalculatePortfolioScenarioInput = {
  ...input,
  assets: [
    { id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO, currency: "BTC" },
    { id: "usdt", symbol: "USDT", name: "Tether", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN, currency: "USD" },
  ],
  transactions: [
    { accountId: "exchange", assetId: "btc", type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "0.02", pricePerUnit: "50000", currency: "USD" },
    { accountId: "exchange", assetId: "usdt", type: TransactionType.INITIAL_BALANCE, basisMethod: BasisMethod.KNOWN_COST, quantity: "2000", pricePerUnit: "1", currency: "USD" },
  ],
  marketPrices: { BTC: "50000", USDT: "1" },
  strategy: [
    { assetClass: AssetClass.CRYPTO, targetPercent: "50", minPercent: "40", maxPercent: "60" },
    { assetClass: AssetClass.CASH, targetPercent: "50", minPercent: "40", maxPercent: "60" },
  ],
  kind: "TRADE",
  sourceAssetId: "usdt",
  sourceAccountId: "exchange",
  destinationAssetId: "btc",
  destinationAccountId: "exchange",
  sourceAmount: "1000",
  amount: "1000",
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
    const externalBuy = calculatePortfolioScenario({ ...input, kind: "EXTERNAL_BUY", amount: "50" });
    expect(externalBuy.reasonCodes).toContain("STANDALONE_BUY");
    expect(externalBuy.projected.totalValue).toBe("1050.00");

    const contribution = calculatePortfolioScenario({ ...input, kind: "CONTRIBUTION", amount: "50" });
    expect(contribution.reasonCodes).toContain("EXTERNAL_CONTRIBUTION");
    expect(contribution.projected.totalValue).toBe("1050.00");

    expect(() => calculatePortfolioScenario({ ...input, kind: "SELL", amount: "100.01" }))
      .toThrow("selected account");
  });

  it("rejects scenarios when current valuation is partial", () => {
    expect(() => calculatePortfolioScenario({
      ...input,
      hasStalePrices: true,
      assets: [...input.assets, { id: "gold", symbol: "GOLD", assetClass: AssetClass.GOLD, assetType: AssetType.OTHER }],
      transactions: [...input.transactions, { accountId: "exchange", assetId: "gold", type: TransactionType.BUY, quantity: "1", pricePerUnit: "10", currency: "USD" }],
    })).toThrow(IncompletePortfolioValuationError);
  });

  it("models an internal trade without adding external capital", () => {
    const result = calculatePortfolioScenario(tradeInput);

    expect(result.reasonCodes).toContain("INTERNAL_TRADE");
    expect(result.current.totalValue).toBe("3000.00");
    expect(result.projected.totalValue).toBe("3000.00");
    expect(result.sourceSymbol).toBe("USDT");
    expect(result.destinationSymbol).toBe("BTC");
    expect(result.sourceAmount).toBe("1000.00");
    expect(result.destinationAmount).toBe("1000.00");
    expect(result.sourceQuantity).toBe("1000");
    expect(result.destinationQuantity).toBe("0.02");
    expect(result.projected.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: "usdt", quantity: "1000" }),
      expect.objectContaining({ assetId: "btc", quantity: "0.04" }),
    ]));
    expect(result.afterComparison).toContainEqual(expect.objectContaining({ assetClass: AssetClass.CRYPTO, currentPercent: "66.67" }));
  });

  it("reduces projected trade value by the fee", () => {
    const result = calculatePortfolioScenario({ ...tradeInput, fee: "2" });

    expect(result.projected.totalValue).toBe("2998.00");
    expect(result.destinationAmount).toBe("998.00");
    expect(result.destinationQuantity).toBe("0.01996");
    expect(result.fee).toBe("2.00");
  });

  it("validates internal trade inputs", () => {
    expect(() => calculatePortfolioScenario({ ...tradeInput, marketPrices: { BTC: "50000" } }))
      .toThrow("Source price is unavailable");
    expect(() => calculatePortfolioScenario({ ...tradeInput, marketPrices: { USDT: "1" } }))
      .toThrow("Destination price is unavailable");
    expect(() => calculatePortfolioScenario({ ...tradeInput, sourceAmount: "2000.01" }))
      .toThrow("Sell amount exceeds");
    expect(() => calculatePortfolioScenario({ ...tradeInput, destinationAssetId: "usdt" }))
      .toThrow("must be different");
    expect(() => calculatePortfolioScenario({ ...tradeInput, fee: "1000" }))
      .toThrow("fee must be less");
    expect(() => calculatePortfolioScenario({ ...tradeInput, fee: "-1" }))
      .toThrow("fee must be non-negative");
  });
});
