import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortfolioReviewView } from "@/app/intelligence/_components/portfolio-review";
import type { IntelligenceReadModel } from "@/features/intelligence/read-model";

describe("Intelligence Portfolio Review presentation", () => {
  it("renders review sections and deterministic evidence without dashboard KPI duplicates", () => {
    const html = renderToStaticMarkup(<PortfolioReviewView model={reviewModel()} />);

    expect(html).toContain("Needs review");
    expect(html).toContain("Watch");
    expect(html).toContain("Resolved");
    expect(html).toContain("Data quality");
    expect(html).toContain("Crypto allocation crossed configured maximum");
    expect(html).toContain("BTC market appreciation");
    expect(html).toContain("Crypto maximum 15%");
    expect(html).toContain("Distance beyond range:");
    expect(html).not.toContain("Portfolio value");
    expect(html).not.toContain("Daily gain / loss");
    expect(html).not.toContain("Market contributors");
    expect(html).not.toContain("Risk summary");
  });
});

function reviewModel(): IntelligenceReadModel {
  return {
    currency: "USD",
    lastUpdated: "2026-08-29T12:00:00.000Z",
    review: {
      state: "NEEDS_REVIEW",
      summary: "One or more portfolio changes need review.",
      period: {
        kind: "PREVIOUS_DAILY_OBSERVATION",
        previousAsOf: "2026-08-28T23:59:59.999Z",
        currentAsOf: "2026-08-29T12:00:00.000Z",
      },
      signals: [{
        id: "STRATEGY:CRYPTO_ABOVE_MAX",
        category: "STRATEGY",
        state: "NEEDS_REVIEW",
        lifecycle: "NEW",
        title: "Crypto allocation crossed configured maximum",
        subject: { kind: "ASSET_CLASS", id: "CRYPTO", name: "Crypto allocation" },
        value: { previous: "14.4", current: "15.3", change: "0.9", unit: "PERCENTAGE_POINTS" },
        primaryCause: { type: "MARKET_PRICE_MOVEMENT", description: "BTC market appreciation.", subject: "BTC", impact: "0.9" },
        causes: [{ type: "MARKET_PRICE_MOVEMENT", description: "BTC market appreciation.", subject: "BTC", impact: "0.9" }],
        affectedRule: { code: "CRYPTO_ABOVE_MAX", description: "Crypto maximum 15%", limit: "15" },
        evidence: [{ label: "Distance beyond range", value: "0.3 pp" }],
        reviewPosture: "Review future contribution direction before changing existing holdings.",
        dataQuality: { state: "COMPLETE", reasons: [] },
      }],
      dataQuality: {
        state: "COMPLETE",
        reasons: [],
        missingPriceSymbols: [],
        stale: false,
        messages: [],
      },
    },
  };
}
