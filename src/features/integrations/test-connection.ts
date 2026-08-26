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
