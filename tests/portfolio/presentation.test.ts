import { AssetClass } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { contributionReasonText } from "@/features/contributions/presentation";
import { parseContributionQueryAmount } from "@/features/contributions/validation";
import {
  formatPortfolioCurrency,
  formatPortfolioSignedCurrency,
  portfolioContributionItems,
  portfolioHoldingTransactions,
  strategyWarningText,
} from "@/features/portfolio/presentation";
import type { PortfolioHoldingRow, PortfolioTransactionRow } from "@/features/portfolio/read-model";
import { portfolioValuationDisplayLabel } from "@/features/portfolio/valuation-presentation";

describe("portfolio presentation helpers", () => {
  it("formats small and very large portfolio values without losing finite output", () => {
    expect(formatPortfolioCurrency("0.01", "EUR")).toContain("0.01");
    expect(formatPortfolioCurrency("999999999999.99", "EUR")).toContain("999,999,999,999.99");
    expect(formatPortfolioSignedCurrency("-123.45", "EUR")).toContain("−");
  });

  it("maps deterministic contribution and strategy reasons to readable text", () => {
    expect(contributionReasonText({ code: "ASSET_CLASS_UNDERWEIGHT", assetClass: AssetClass.ETF })).toBe("ETF is currently below your target allocation.");
    expect(strategyWarningText({ code: "CRYPTO_ABOVE_MAX", assetClass: AssetClass.CRYPTO, currentPercent: "16.8", limitPercent: "15" })).toBe("Crypto is 16.8%, above the configured maximum of 15.0%.");
  });

  it("accepts only positive cent-safe portfolio query amounts", () => {
    expect(parseContributionQueryAmount("1000.25")).toBe("1000.25");
    expect(parseContributionQueryAmount("0")).toBeNull();
    expect(parseContributionQueryAmount("1.234")).toBeNull();
    expect(parseContributionQueryAmount(["100", "200"])).toBeNull();
  });

  it("labels partial valuation as known value instead of exact portfolio value", () => {
    expect(portfolioValuationDisplayLabel({ isPartial: false })).toBe("Portfolio value");
    expect(portfolioValuationDisplayLabel({ isPartial: true })).toBe("Known value");
  });

  it("keeps class-only contribution allocations visible in the portfolio summary list", () => {
    const items = portfolioContributionItems({
      plan: {
        contributionAmount: "1000.00",
        allocations: [
          { assetClass: AssetClass.ETF, amount: "800.00", percentOfContribution: "80.00" },
          { assetClass: AssetClass.CRYPTO, amount: "200.00", percentOfContribution: "20.00" },
        ],
        assetRecommendations: [{
          assetId: "btc",
          symbol: "BTC",
          name: "Bitcoin",
          assetClass: AssetClass.CRYPTO,
          amount: "200.00",
          percentOfContribution: "20.00",
          targetPercentOfClass: "100.00",
          effectiveTargetPercent: "20.00",
        }],
        before: { holdings: [], valuedHoldings: [], totalValue: "0.00", allocation: [], missingPriceSymbols: [] },
        projectedAfter: { holdings: [], valuedHoldings: [], totalValue: "1000.00", allocation: [], missingPriceSymbols: [] },
        reasons: [],
      },
      beforeComparison: [],
      afterComparison: [],
      warnings: [],
      reasons: [],
      isCustomized: false,
    });

    expect(items).toEqual([
      expect.objectContaining({ key: "class-ETF", symbol: "ETF", name: "Choose an asset", amount: "800.00" }),
      expect.objectContaining({ key: "asset-btc", symbol: "BTC", name: "Bitcoin", amount: "200.00" }),
    ]);
  });

  it("filters holding transactions by exact source or destination asset-account leg", () => {
    const holding = holdingRow("btc", "bybit");
    const transactions = [
      transactionRow("standalone-btc-bybit", "btc", "bybit"),
      transactionRow("btc-ledger", "btc", "ledger"),
      transactionRow("eth-bybit", "eth", "bybit"),
      transactionRow("source-transfer", "btc", "bybit", destination("btc", "ledger")),
      transactionRow("destination-transfer", "btc", "ledger", destination("btc", "bybit")),
      transactionRow("destination-trade", "usdt", "bybit", destination("btc", "bybit")),
    ];

    expect(portfolioHoldingTransactions(transactions, holding).map((transaction) => transaction.id)).toEqual([
      "standalone-btc-bybit",
      "source-transfer",
      "destination-transfer",
      "destination-trade",
    ]);
  });
});

function holdingRow(assetId: string, accountId: string) {
  return { assetId, accountId } as PortfolioHoldingRow;
}

function destination(assetId: string, accountId: string) {
  return { assetId, accountId } as PortfolioTransactionRow["destination"];
}

function transactionRow(
  id: string,
  assetId: string,
  accountId: string,
  transactionDestination: PortfolioTransactionRow["destination"] = null,
) {
  return { id, assetId, accountId, destination: transactionDestination } as PortfolioTransactionRow;
}
