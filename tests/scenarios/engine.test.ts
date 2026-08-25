import { AssetClass, AssetType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { EngineAsset, EngineStrategyAllocation, EngineTransaction } from "@/features/portfolio-engine";
import { simulateMarketScenario, simulateTransactionScenario } from "@/features/scenarios/engine";
import { scenarioPresets } from "@/features/scenarios/presets";

const assets: EngineAsset[] = [
  { id: "etf", symbol: "VWCE", assetClass: AssetClass.ETF, assetType: AssetType.ETF },
  { id: "btc", symbol: "BTC", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO },
  { id: "eth", symbol: "ETH", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO },
  { id: "alt", symbol: "ALT", assetClass: AssetClass.CRYPTO, assetType: AssetType.CRYPTO },
  { id: "gold", symbol: "PHYSICAL_GOLD", assetClass: AssetClass.GOLD, assetType: AssetType.PHYSICAL_GOLD },
  { id: "xaut", symbol: "XAUT", assetClass: AssetClass.GOLD, assetType: AssetType.TOKENIZED_GOLD },
  { id: "eur", symbol: "EUR", assetClass: AssetClass.CASH, assetType: AssetType.FIAT },
  { id: "usdt", symbol: "USDT", assetClass: AssetClass.CASH, assetType: AssetType.STABLECOIN },
];

const strategy: EngineStrategyAllocation[] = [
  { assetClass: AssetClass.ETF, targetPercent: "70", minPercent: "60", maxPercent: "80" },
  { assetClass: AssetClass.CRYPTO, targetPercent: "15", minPercent: "10", maxPercent: "20" },
  { assetClass: AssetClass.GOLD, targetPercent: "10", minPercent: "5", maxPercent: "15" },
  { assetClass: AssetClass.CASH, targetPercent: "5", minPercent: "0", maxPercent: "10" },
];

const baseTransactions: EngineTransaction[] = [
  tx("etf", "100"),
  tx("btc", "1"),
];
const basePrices = { VWCE: "10", BTC: "100", ETH: "50", ALT: "1", PHYSICAL_GOLD: "5", XAUT: "50", EUR: "1", USDT: "1" };

describe("transaction scenario", () => {
  it("converts a EUR BUY to quantity and treats it as external cashflow", () => {
    const result = simulateTransactionScenario({
      assets, transactions: baseTransactions, marketPrices: basePrices, strategy,
      assetId: "btc", type: "BUY", amount: "500",
    });

    expect(result.quantity).toBe("5");
    expect(result.current.totalValue).toBe("1100.00");
    expect(result.projected.totalValue).toBe("1600.00");
    expect(result.afterComparison.find((item) => item.assetClass === AssetClass.CRYPTO)?.currentPercent).toBe("37.50");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "CRYPTO_ABOVE_MAX" }));
    expect(result.reasonCodes).toContain("PROJECTED_ABOVE_MAX");
  });

  it("subtracts value for a SELL and rejects selling above global holdings", () => {
    const result = simulateTransactionScenario({
      assets, transactions: baseTransactions, marketPrices: basePrices, strategy,
      assetId: "btc", type: "SELL", amount: "50",
    });
    expect(result.quantity).toBe("0.5");
    expect(result.projected.totalValue).toBe("1050.00");

    expect(() => simulateTransactionScenario({
      assets, transactions: baseTransactions, marketPrices: basePrices, strategy,
      assetId: "btc", type: "SELL", amount: "100.01",
    })).toThrow("exceeds the available BTC holding");
  });

  it("rejects missing and zero selected-asset prices", () => {
    expect(() => simulateTransactionScenario({
      assets, transactions: baseTransactions, marketPrices: { VWCE: "10" }, strategy,
      assetId: "btc", type: "BUY", amount: "10",
    })).toThrow("Current price is unavailable for BTC");
    expect(() => simulateTransactionScenario({
      assets, transactions: baseTransactions, marketPrices: { ...basePrices, BTC: "0" }, strategy,
      assetId: "btc", type: "BUY", amount: "10",
    })).toThrow("must be greater than zero");
  });

  it("marks a simulation partial when another holding has no price", () => {
    const result = simulateTransactionScenario({
      assets,
      transactions: [...baseTransactions, tx("gold", "1")],
      marketPrices: basePricesWithout("PHYSICAL_GOLD"),
      strategy,
      assetId: "btc", type: "BUY", amount: "10",
    });
    expect(result.reasonCodes).toContain("PARTIAL_VALUATION");
    expect(result.current.missingPriceSymbols).toEqual(["PHYSICAL_GOLD"]);
  });

  it("treats an allocation exactly at its configured maximum as in range", () => {
    const result = simulateTransactionScenario({
      assets,
      transactions: [tx("etf", "80"), tx("btc", "1")],
      marketPrices: basePrices,
      strategy,
      assetId: "btc", type: "BUY", amount: "100",
    });
    const crypto = result.afterComparison.find((item) => item.assetClass === AssetClass.CRYPTO);
    expect(crypto).toEqual(expect.objectContaining({ currentPercent: "20.00", status: "IN_RANGE" }));
    expect(result.warnings.some((warning) => warning.code === "CRYPTO_ABOVE_MAX")).toBe(false);
  });

  it("rejects zero and non-finite transaction amounts", () => {
    for (const amount of ["0", "NaN", "Infinity"]) {
      expect(() => simulateTransactionScenario({
        assets, transactions: baseTransactions, marketPrices: basePrices, strategy,
        assetId: "btc", type: "BUY", amount,
      })).toThrow();
    }
  });
});

describe("market scenario", () => {
  const transactions = [
    tx("etf", "100"),
    tx("btc", "1"),
    tx("eth", "2"),
    tx("alt", "10"),
    tx("gold", "10"),
    tx("xaut", "1"),
    tx("eur", "100"),
    tx("usdt", "100"),
  ];

  it("applies bucket shocks and reconciles gain/loss contributions", () => {
    const result = simulateMarketScenario({
      assets, transactions, marketPrices: basePrices,
      shocks: { ETF: "-10", BTC: "-50", ETH: "-55", GOLD: "10", CASH: "0" },
    });

    expect(result.currentValue).toBe("1510.00");
    expect(result.scenarioValue).toBe("1315.00");
    expect(result.absoluteChange).toBe("-195.00");
    expect(result.percentageChange).toBe("-12.91");
    expect(result.contributions).toEqual([
      { bucket: "ETF", amount: "-100.00", shockPercent: "-10.00" },
      { bucket: "BTC", amount: "-50.00", shockPercent: "-50.00" },
      { bucket: "ETH", amount: "-55.00", shockPercent: "-55.00" },
      { bucket: "GOLD", amount: "10.00", shockPercent: "10.00" },
      { bucket: "CASH", amount: "0.00", shockPercent: "0.00" },
    ]);
    expect(result.contributions.reduce((sum, item) => sum + Number(item.amount), 0)).toBe(Number(result.absoluteChange));
  });

  it("keeps every named preset explicit and executable", () => {
    expect(scenarioPresets.map((preset) => preset.name)).toEqual([
      "Crypto Crash", "Equity Bear Market", "Risk-Off", "Bull Market",
    ]);
    for (const preset of scenarioPresets) {
      expect(() => simulateMarketScenario({ assets, transactions, marketPrices: basePrices, shocks: preset.shocks })).not.toThrow();
    }
  });

  it("groups physical and tokenized gold together and fiat/stablecoins as cash", () => {
    const result = simulateMarketScenario({
      assets, transactions, marketPrices: basePrices,
      shocks: { ETF: "0", BTC: "0", ETH: "0", GOLD: "100", CASH: "10" },
    });
    expect(result.contributions.find((item) => item.bucket === "GOLD")?.amount).toBe("100.00");
    expect(result.contributions.find((item) => item.bucket === "CASH")?.amount).toBe("20.00");
  });

  it("supports a total-loss floor, positive shocks, and unchanged unbucketed assets", () => {
    const result = simulateMarketScenario({
      assets, transactions, marketPrices: basePrices,
      shocks: { ETF: "-100", BTC: "20", ETH: "30", GOLD: "0", CASH: "0" },
    });
    expect(result.contributions.find((item) => item.bucket === "ETF")?.amount).toBe("-1000.00");
    expect(result.projected.valuedHoldings.find((item) => item.assetId === "alt")?.value).toBe("10.00");
    expect(() => simulateMarketScenario({
      assets, transactions, marketPrices: basePrices,
      shocks: { ETF: "-100.01", BTC: "0", ETH: "0", GOLD: "0", CASH: "0" },
    })).toThrow("between -100% and 1000%");
  });

  it("returns unavailable percentage change for an empty portfolio", () => {
    const result = simulateMarketScenario({
      assets, transactions: [], marketPrices: basePrices,
      shocks: { ETF: "-25", BTC: "-50", ETH: "-50", GOLD: "10", CASH: "0" },
    });
    expect(result.currentValue).toBe("0.00");
    expect(result.absoluteChange).toBe("0.00");
    expect(result.percentageChange).toBeNull();
  });

  it("leaves values unchanged when all editable shocks are zero", () => {
    const result = simulateMarketScenario({
      assets, transactions, marketPrices: basePrices,
      shocks: { ETF: "0", BTC: "0", ETH: "0", GOLD: "0", CASH: "0" },
    });
    expect(result.scenarioValue).toBe(result.currentValue);
    expect(result.absoluteChange).toBe("0.00");
    expect(result.contributions.every((item) => item.amount === "0.00")).toBe(true);
  });

  it("keeps missing prices non-fatal and explicitly marks partial valuation", () => {
    const result = simulateMarketScenario({
      assets, transactions, marketPrices: basePricesWithout("XAUT"),
      shocks: { ETF: "0", BTC: "0", ETH: "0", GOLD: "10", CASH: "0" },
    });
    expect(result.isPartial).toBe(true);
    expect(result.missingPriceSymbols).toEqual(["XAUT"]);
    expect(result.contributions.find((item) => item.bucket === "GOLD")?.amount).toBe("5.00");
  });
});

function tx(assetId: string, quantity: string): EngineTransaction {
  return { assetId, accountId: "account", type: TransactionType.INITIAL_BALANCE, quantity };
}

function basePricesWithout(symbol: keyof typeof basePrices) {
  const prices: Partial<typeof basePrices> = { ...basePrices };
  delete prices[symbol];
  return prices;
}
