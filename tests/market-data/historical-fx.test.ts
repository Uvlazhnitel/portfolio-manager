import { FxRateSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { HistoricalFxRateService } from "@/features/market-data/historical-fx";
import { FrankfurterMarketDataProvider } from "@/features/market-data/providers/frankfurter";

describe("historical transaction FX", () => {
  it("uses an identity rate without calling Frankfurter", async () => {
    const fetcher = vi.fn();
    const result = await new HistoricalFxRateService(new FrankfurterMarketDataProvider(fetcher as typeof fetch)).resolve({
      fromCurrency: "usd",
      toCurrency: "USD",
      executedAt: "2026-09-07",
    });

    expect(result).toEqual({ rate: "1", source: FxRateSource.IDENTITY, date: new Date("2026-09-07T00:00:00.000Z") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads and records the historical rate for the transaction date", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ date: "2026-09-04", base: "EUR", quote: "USD", rate: 1.1624 })));
    const result = await new HistoricalFxRateService(new FrankfurterMarketDataProvider(fetcher)).resolve({
      fromCurrency: "EUR",
      toCurrency: "USD",
      executedAt: "2026-09-05",
    });

    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ searchParams: expect.any(URLSearchParams) }), expect.anything());
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("date=2026-09-05");
    expect(result).toEqual({ rate: "1.1624", source: FxRateSource.FRANKFURTER, date: new Date("2026-09-04T00:00:00.000Z") });
  });

  it("accepts a positive manual broker rate and rejects invalid values", async () => {
    const service = new HistoricalFxRateService();
    await expect(service.resolve({ fromCurrency: "EUR", toCurrency: "USD", executedAt: "2026-09-07", manualRate: "1.1234567890123" })).resolves.toEqual({
      rate: "1.123456789012",
      source: FxRateSource.MANUAL,
      date: new Date("2026-09-07T00:00:00.000Z"),
    });
    await expect(service.resolve({ fromCurrency: "EUR", toCurrency: "USD", executedAt: "2026-09-07", manualRate: "0" })).rejects.toThrow("greater than zero");
    await expect(service.resolve({ fromCurrency: "EU", toCurrency: "USD", executedAt: "2026-09-07" })).rejects.toThrow("three-letter");
  });

  it("asks for a manual rate when the provider is unavailable", async () => {
    const provider = new FrankfurterMarketDataProvider(vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch);
    await expect(new HistoricalFxRateService(provider).resolve({ fromCurrency: "EUR", toCurrency: "USD", executedAt: "2026-09-07" })).rejects.toThrow("Enter the FX rate manually");
  });
});
