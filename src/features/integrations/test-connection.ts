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
