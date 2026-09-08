import { FxRateSource } from "@prisma/client";
import { decimal } from "@/features/portfolio-engine/decimal";
import { FrankfurterMarketDataProvider } from "@/features/market-data/providers/frankfurter";

export class HistoricalFxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalFxRateError";
  }
}

export type ResolvedHistoricalFxRate = {
  rate: string;
  source: FxRateSource;
  date: Date;
};

export class HistoricalFxRateService {
  constructor(private readonly provider = new FrankfurterMarketDataProvider()) {}

  async resolve(input: {
    fromCurrency: string;
    toCurrency: string;
    executedAt: string | Date;
    manualRate?: string;
  }): Promise<ResolvedHistoricalFxRate | null> {
    const fromCurrency = normalizeCurrency(input.fromCurrency);
    const toCurrency = normalizeCurrency(input.toCurrency);
    const executedAt = new Date(input.executedAt);
    if (!Number.isFinite(executedAt.getTime())) throw new HistoricalFxRateError("Choose a valid transaction date.");
    const requestedDate = executedAt.toISOString().slice(0, 10);

    if (fromCurrency === toCurrency) {
      return { rate: "1", source: FxRateSource.IDENTITY, date: new Date(`${requestedDate}T00:00:00.000Z`) };
    }

    const manualRate = input.manualRate?.trim();
    if (manualRate) {
      let parsed;
      try {
        parsed = decimal(manualRate);
      } catch {
        throw new HistoricalFxRateError(`Enter a valid ${fromCurrency} to ${toCurrency} FX rate.`);
      }
      if (!parsed.greaterThan(0)) throw new HistoricalFxRateError("FX rate must be greater than zero.");
      return { rate: parsed.toDecimalPlaces(12).toString(), source: FxRateSource.MANUAL, date: new Date(`${requestedDate}T00:00:00.000Z`) };
    }

    try {
      const resolved = await this.provider.getHistoricalRate(fromCurrency, toCurrency, requestedDate);
      const rateDate = new Date(`${resolved.date}T00:00:00.000Z`);
      if (!Number.isFinite(rateDate.getTime()) || rateDate.getTime() > new Date(`${requestedDate}T23:59:59.999Z`).getTime()) {
        throw new Error("Historical FX response date is invalid.");
      }
      return { rate: decimal(resolved.rate).toDecimalPlaces(12).toString(), source: FxRateSource.FRANKFURTER, date: rateDate };
    } catch {
      throw new HistoricalFxRateError(`Could not load the historical ${fromCurrency} to ${toCurrency} rate. Enter the FX rate manually.`);
    }
  }
}

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new HistoricalFxRateError("Currency must be a three-letter fiat code.");
  return normalized;
}
