import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import { IntegrationSettingsService } from "@/features/integrations/service";
import { integrationProviderSchema } from "@/features/integrations/validation";
import { IntegrationProvider, type IntegrationProvider as IntegrationProviderName } from "@/lib/domain/enums";

type ConnectionDependencies = {
  service?: IntegrationSettingsService;
  testOpenAI?: (apiKey: string, model: string) => Promise<void>;
  testCoinGecko?: (apiKey: string | null) => Promise<void>;
  testAlphaVantage?: (apiKey: string) => Promise<void>;
  testTwelveData?: (apiKey: string) => Promise<void>;
};

export class IntegrationConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationConnectionError";
  }
}

export async function testIntegrationConnection(
  providerInput: IntegrationProviderName,
  dependencies: ConnectionDependencies = {},
) {
  const provider = integrationProviderSchema.parse(providerInput);
  const service = dependencies.service ?? new IntegrationSettingsService();
  const configuration = await service.resolve(provider);

  if (provider === IntegrationProvider.OPENAI) {
    if (!configuration.apiKey) {
      throw new IntegrationConnectionError(configuration.error ?? "OpenAI API key is not configured.");
    }
    try {
      await (dependencies.testOpenAI ?? probeOpenAI)(configuration.apiKey, configuration.model ?? "gpt-5-mini");
      return { message: `OpenAI connection succeeded with ${configuration.model ?? "gpt-5-mini"}.` };
    } catch (error) {
      if (error instanceof IntegrationConnectionError) throw error;
      throw new IntegrationConnectionError("OpenAI connection failed. Verify the API key and model.");
    }
  }

  if (provider === IntegrationProvider.TWELVE_DATA) {
    if (!configuration.apiKey) {
      throw new IntegrationConnectionError(configuration.error ?? "Twelve Data API key is not configured.");
    }
    try {
      await (dependencies.testTwelveData ?? probeTwelveData)(configuration.apiKey);
      return { message: "Twelve Data connection succeeded for VWCE/XETR and EUR/USD." };
    } catch (error) {
      if (error instanceof IntegrationConnectionError) throw error;
      throw new IntegrationConnectionError("Twelve Data connection failed. Verify the API key and Grow access to Xetra.");
    }
  }

  if (provider === IntegrationProvider.ALPHA_VANTAGE) {
    if (!configuration.apiKey) {
      throw new IntegrationConnectionError(configuration.error ?? "Alpha Vantage API key is not configured.");
    }
    try {
      await (dependencies.testAlphaVantage ?? probeAlphaVantage)(configuration.apiKey);
      return { message: "Alpha Vantage connection succeeded for VWCE.DEX and EUR/USD." };
    } catch (error) {
      if (error instanceof IntegrationConnectionError) throw error;
      throw new IntegrationConnectionError("Alpha Vantage connection failed. Verify the API key, daily quota, and VWCE.DEX availability.");
    }
  }

  try {
    await (dependencies.testCoinGecko ?? probeCoinGecko)(configuration.apiKey);
    return {
      message: configuration.apiKey
        ? "CoinGecko authenticated connection succeeded."
        : "CoinGecko public API connection succeeded.",
    };
  } catch (error) {
    if (error instanceof IntegrationConnectionError) throw error;
    throw new IntegrationConnectionError("CoinGecko connection failed. Verify the API key or try again later.");
  }
}

async function probeOpenAI(apiKey: string, model: string) {
  await new OpenAI({ apiKey }).models.retrieve(model);
}

async function probeCoinGecko(apiKey: string | null) {
  const headers = new Headers({ Accept: "application/json" });
  if (apiKey) headers.set("x-cg-demo-api-key", apiKey);
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur", {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("CoinGecko request failed.");
  const payload = z.object({ bitcoin: z.object({ eur: z.number().positive() }) }).parse(await response.json());
  void payload;
}

async function probeTwelveData(apiKey: string) {
  const quote = new URL("https://api.twelvedata.com/quote");
  quote.searchParams.set("symbol", "VWCE");
  quote.searchParams.set("mic_code", "XETR");
  quote.searchParams.set("apikey", apiKey);
  const fx = new URL("https://api.twelvedata.com/exchange_rate");
  fx.searchParams.set("symbol", "EUR/USD");
  fx.searchParams.set("apikey", apiKey);

  const [quoteResponse, fxResponse] = await Promise.all([
    fetch(quote, { cache: "no-store", signal: AbortSignal.timeout(5_000) }),
    fetch(fx, { cache: "no-store", signal: AbortSignal.timeout(5_000) }),
  ]);
  if (!quoteResponse.ok || !fxResponse.ok) throw new Error("Twelve Data request failed.");

  const errorSchema = z.object({ status: z.literal("error"), message: z.string().optional() });
  const quotePayload: unknown = await quoteResponse.json();
  const fxPayload: unknown = await fxResponse.json();
  if (errorSchema.safeParse(quotePayload).success || errorSchema.safeParse(fxPayload).success) {
    throw new Error("Twelve Data rejected the request.");
  }
  z.object({ symbol: z.literal("VWCE"), mic_code: z.literal("XETR"), currency: z.literal("EUR"), close: z.string().regex(/^\d+(?:\.\d+)?$/) }).parse(quotePayload);
  z.object({ symbol: z.literal("EUR/USD"), rate: z.number().positive(), timestamp: z.number().int().positive() }).parse(fxPayload);
}

async function probeAlphaVantage(apiKey: string) {
  const daily = new URL("https://www.alphavantage.co/query");
  daily.searchParams.set("function", "TIME_SERIES_DAILY");
  daily.searchParams.set("symbol", "VWCE.DEX");
  daily.searchParams.set("outputsize", "compact");
  daily.searchParams.set("apikey", apiKey);
  const fx = new URL("https://www.alphavantage.co/query");
  fx.searchParams.set("function", "CURRENCY_EXCHANGE_RATE");
  fx.searchParams.set("from_currency", "EUR");
  fx.searchParams.set("to_currency", "USD");
  fx.searchParams.set("apikey", apiKey);

  const dailyResponse = await fetch(daily, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  await wait(1_300);
  const fxResponse = await fetch(fx, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!dailyResponse.ok || !fxResponse.ok) throw new Error("Alpha Vantage request failed.");

  const problemSchema = z.union([
    z.object({ "Error Message": z.string().min(1) }),
    z.object({ Note: z.string().min(1) }),
    z.object({ Information: z.string().min(1) }),
  ]);
  const dailyPayload: unknown = await dailyResponse.json();
  const fxPayload: unknown = await fxResponse.json();
  if (problemSchema.safeParse(dailyPayload).success || problemSchema.safeParse(fxPayload).success) {
    throw new Error("Alpha Vantage rejected or throttled the request.");
  }

  const series = z.object({
    "Meta Data": z.object({ "2. Symbol": z.literal("VWCE.DEX") }),
    "Time Series (Daily)": z.record(z.string(), z.object({ "4. close": z.string().regex(/^\d+(?:\.\d+)?$/) })),
  }).parse(dailyPayload)["Time Series (Daily)"];
  if (Object.keys(series).length === 0) throw new Error("Alpha Vantage returned no VWCE.DEX prices.");
  z.object({
    "Realtime Currency Exchange Rate": z.object({
      "1. From_Currency Code": z.literal("EUR"),
      "3. To_Currency Code": z.literal("USD"),
      "5. Exchange Rate": z.string().regex(/^\d+(?:\.\d+)?$/),
    }),
  }).parse(fxPayload);
}

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
