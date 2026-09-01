import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const performanceClient = readFileSync("src/app/performance/_components/performance-client.tsx", "utf8");
const intelligencePage = readFileSync("src/app/intelligence/page.tsx", "utf8");

describe("performance and daily brief copy", () => {
  it("labels the former TWR metric as cashflow-adjusted return", () => {
    expect(performanceClient).toContain('label="Cashflow-adjusted return"');
    expect(performanceClient).not.toContain('label="TWR"');
    expect(performanceClient).not.toContain(">TWR<");
    expect(performanceClient).toContain("it is not strict intraday TWR");
    expect(performanceClient).toContain("Cashflow-adjusted return removes daily deposits and withdrawals using day-level observations");
  });

  it("explains daily cashflow timing and contributor coverage", () => {
    expect(intelligencePage).toContain('label="Cashflow-adjusted return"');
    expect(intelligencePage).toContain("large same-day cashflows can affect interpretation");
    expect(intelligencePage).toContain("same-day purchases from new external cashflow may affect daily gain without appearing here");
  });
});
