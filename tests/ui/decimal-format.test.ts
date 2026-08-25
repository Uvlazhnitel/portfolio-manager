import { describe, expect, it } from "vitest";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";
import { formatUtcDate, formatUtcTimestamp } from "@/lib/format/date";

describe("Decimal-safe presentation", () => {
  it("formats values larger than JavaScript's safe integer range without losing cents", () => {
    expect(formatDecimalCurrency("9007199254740993.01", "EUR")).toBe("€9,007,199,254,740,993.01");
  });

  it("rounds, signs, and formats negative financial states deterministically", () => {
    expect(formatDecimalCurrency("-1234.567", "EUR")).toBe("−€1,234.57");
    expect(formatDecimalPercent("16.249", 2)).toBe("16.25%");
    expect(decimalSign("-0.00000000")).toBe(0);
    expect(decimalSign("-0.01")).toBe(-1);
  });

  it("returns a dash for malformed values", () => {
    expect(formatDecimalCurrency("NaN", "EUR")).toBe("—");
    expect(formatDecimalPercent("Infinity")).toBe("—");
  });
});

describe("hydration-safe date presentation", () => {
  it("formats dates explicitly in UTC", () => {
    expect(formatUtcTimestamp("2026-08-25T11:47:35.000Z")).toBe("25 Aug 2026, 11:47 UTC");
    expect(formatUtcDate("2026-08-25T23:59:59.000-07:00")).toBe("26 Aug 2026");
  });
});
