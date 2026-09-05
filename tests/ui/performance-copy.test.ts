import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const performanceClient = readFileSync("src/app/performance/_components/performance-client.tsx", "utf8");
const intelligenceReview = readFileSync("src/app/intelligence/_components/portfolio-review.tsx", "utf8");

describe("performance and daily brief copy", () => {
  it("labels the former TWR metric as cashflow-adjusted return", () => {
    expect(performanceClient).toContain('label="Cashflow-adjusted return"');
    expect(performanceClient).not.toContain('label="TWR"');
    expect(performanceClient).not.toContain(">TWR<");
    expect(performanceClient).toContain("it is not strict intraday TWR");
    expect(performanceClient).toContain("Cashflow-adjusted return removes daily deposits and withdrawals using day-level observations");
  });

  it("keeps Intelligence focused on review signals instead of duplicate dashboard KPIs", () => {
    expect(intelligenceReview).toContain('title="Needs review"');
    expect(intelligenceReview).toContain('title="Watch"');
    expect(intelligenceReview).toContain('title="Resolved"');
    expect(intelligenceReview).toContain("Data quality");
    expect(intelligenceReview).toContain("Portfolio is clear");
    expect(intelligenceReview).not.toContain("Daily gain / loss");
    expect(intelligenceReview).not.toContain("Cashflow-adjusted return");
    expect(intelligenceReview).not.toContain("Market contributors");
    expect(intelligenceReview).not.toContain("Risk summary");
  });
});
