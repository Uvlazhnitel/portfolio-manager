import { describe, expect, it } from "vitest";
import { chartRangeLabel, filterChartRowsByRange } from "@/components/ui/chart-range-selector";

const rows = [
  { date: "2026-01-15", value: 1 },
  { date: "2026-05-27", value: 2 },
  { date: "2026-05-28", value: 3 },
  { date: "2026-06-27", value: 4 },
  { date: "2026-07-27", value: 5 },
  { date: "2026-08-20", value: 6 },
  { date: "2026-08-21", value: 7 },
  { date: "2026-08-28", value: 8 },
];

describe("chart range selector helpers", () => {
  it("keeps every point for All", () => {
    expect(filterChartRowsByRange(rows, "ALL")).toEqual(rows);
  });

  it("filters the last 7 days relative to the latest available point and includes the boundary", () => {
    expect(filterChartRowsByRange(rows, "7D").map((row) => row.date)).toEqual(["2026-08-21", "2026-08-28"]);
  });

  it("filters 1D relative to the latest available point", () => {
    expect(filterChartRowsByRange(rows, "1D").map((row) => row.date)).toEqual(["2026-08-28"]);
  });

  it("filters month ranges relative to the latest available point and includes the boundary", () => {
    expect(filterChartRowsByRange(rows, "1M").map((row) => row.date)).toEqual(["2026-08-20", "2026-08-21", "2026-08-28"]);
    expect(filterChartRowsByRange(rows, "3M").map((row) => row.date)).toEqual(["2026-05-28", "2026-06-27", "2026-07-27", "2026-08-20", "2026-08-21", "2026-08-28"]);
  });

  it("keeps one-year boundary points", () => {
    expect(filterChartRowsByRange(rows, "1Y")).toEqual(rows);
  });

  it("handles empty histories", () => {
    expect(filterChartRowsByRange([], "7D")).toEqual([]);
  });

  it("labels All as since tracking and shorter ranges as active periods", () => {
    const formatter = (value: string) => value;
    expect(chartRangeLabel("ALL", "2026-08-26", formatter)).toBe("Since 2026-08-26");
    expect(chartRangeLabel("7D", "2026-08-26", formatter)).toBe("Last 7D");
    expect(chartRangeLabel("1D", "2026-08-26", formatter)).toBe("Last 1D");
  });
});
