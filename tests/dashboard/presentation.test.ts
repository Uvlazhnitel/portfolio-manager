import { AssetClass } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { contributionReasonText } from "@/features/contributions/presentation";
import { parseContributionQueryAmount } from "@/features/contributions/validation";
import {
  formatDashboardCurrency,
  formatDashboardSignedCurrency,
  strategyWarningText,
} from "@/features/dashboard/presentation";

describe("dashboard presentation helpers", () => {
  it("formats small and very large portfolio values without losing finite output", () => {
    expect(formatDashboardCurrency("0.01", "EUR")).toContain("0.01");
    expect(formatDashboardCurrency("999999999999.99", "EUR")).toContain("999,999,999,999.99");
    expect(formatDashboardSignedCurrency("-123.45", "EUR")).toContain("−");
  });

  it("maps deterministic contribution and strategy reasons to readable text", () => {
    expect(contributionReasonText({ code: "ASSET_CLASS_UNDERWEIGHT", assetClass: AssetClass.ETF })).toBe("ETF is currently below your target allocation.");
    expect(strategyWarningText({ code: "CRYPTO_ABOVE_MAX", assetClass: AssetClass.CRYPTO, currentPercent: "16.8", limitPercent: "15" })).toBe("Crypto is 16.8%, above the configured maximum of 15.0%.");
  });

  it("accepts only positive cent-safe dashboard query amounts", () => {
    expect(parseContributionQueryAmount("1000.25")).toBe("1000.25");
    expect(parseContributionQueryAmount("0")).toBeNull();
    expect(parseContributionQueryAmount("1.234")).toBeNull();
    expect(parseContributionQueryAmount(["100", "200"])).toBeNull();
  });
});
