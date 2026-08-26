import "server-only";

import type { IntegrationProvider as PrismaIntegrationProvider, Prisma } from "@prisma/client";
import { decryptIntegrationSecret, encryptIntegrationSecret, isIntegrationEncryptionConfigured } from "@/features/integrations/crypto";
import { IntegrationSettingsRepository, type IntegrationSettingsStore } from "@/features/integrations/repository";
import { openAIModelSchema, saveIntegrationSettingSchema, type SaveIntegrationSettingInput } from "@/features/integrations/validation";
import { IntegrationProvider, type IntegrationProvider as IntegrationProviderName } from "@/lib/domain/enums";

export type CredentialSource = "DATABASE" | "ENVIRONMENT" | "PUBLIC" | "NONE" | "UNAVAILABLE";

type RuntimeConfiguration = {
  provider: IntegrationProviderName;
  apiKey: string | null;
  source: CredentialSource;
  suffix: string | null;
  model: string | null;
  updatedAt: Date | null;
  error: string | null;
};

export type IntegrationStatus = Omit<RuntimeConfiguration, "apiKey"> & {
  isConfigured: boolean;
};

type IntegrationEnvironment = {
  APP_ENCRYPTION_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  COINGECKO_API_KEY?: string;
  TWELVE_DATA_API_KEY?: string;
};

export class IntegrationSettingsService {
  constructor(
    private readonly store: IntegrationSettingsStore = new IntegrationSettingsRepository(),
    private readonly environment: IntegrationEnvironment = process.env as IntegrationEnvironment,
  ) {}

  async resolve(provider: IntegrationProviderName): Promise<RuntimeConfiguration> {
    const record = await this.store.find(provider as PrismaIntegrationProvider);
    const model = provider === IntegrationProvider.OPENAI
      ? configuredModel(record?.config, this.environment.OPENAI_MODEL)
      : null;

    if (record?.encryptedApiKey) {
      try {
        return {
          provider,
          apiKey: decryptIntegrationSecret(record.encryptedApiKey, provider, this.environment.APP_ENCRYPTION_KEY),
          source: "DATABASE",
          suffix: record.apiKeySuffix,
          model,
          updatedAt: record.updatedAt,
          error: null,
        };
      } catch {
        return {
          provider,
          apiKey: null,
          source: "UNAVAILABLE",
          suffix: record.apiKeySuffix,
          model,
          updatedAt: record.updatedAt,
          error: "The stored key cannot be decrypted. Check APP_ENCRYPTION_KEY on the server.",
        };
      }
    }

    const environmentKey = environmentApiKey(provider, this.environment);
    if (environmentKey) {
      return {
        provider,
        apiKey: environmentKey,
        source: "ENVIRONMENT",
        suffix: suffix(environmentKey),
        model,
        updatedAt: null,
        error: null,
      };
    }

    return {
      provider,
      apiKey: null,
      source: provider === IntegrationProvider.COINGECKO ? "PUBLIC" : "NONE",
      suffix: null,
      model,
      updatedAt: record?.updatedAt ?? null,
      error: null,
    };
  }

  async status(provider: IntegrationProviderName): Promise<IntegrationStatus> {
    const resolved = await this.resolve(provider);
    const { apiKey, ...publicStatus } = resolved;
    return { ...publicStatus, isConfigured: Boolean(apiKey) };
  }

  async save(input: SaveIntegrationSettingInput) {
    const parsed = saveIntegrationSettingSchema.parse(input);
    if (parsed.apiKey && !isIntegrationEncryptionConfigured(this.environment.APP_ENCRYPTION_KEY)) {
      throw new Error("APP_ENCRYPTION_KEY is not configured correctly on the server.");
    }
    const existing = await this.store.find(parsed.provider as PrismaIntegrationProvider);
    const config: Prisma.InputJsonObject = parsed.provider === IntegrationProvider.OPENAI
      ? { model: parsed.model ?? configuredModel(existing?.config, this.environment.OPENAI_MODEL) }
      : {};
    const encryptedApiKey = parsed.apiKey
      ? encryptIntegrationSecret(parsed.apiKey, parsed.provider, this.environment.APP_ENCRYPTION_KEY)
      : undefined;
    return this.store.upsert({
      provider: parsed.provider as PrismaIntegrationProvider,
      encryptedApiKey,
      apiKeySuffix: parsed.apiKey ? suffix(parsed.apiKey) : undefined,
      config,
    });
  }

  clearApiKey(provider: IntegrationProviderName) {
    return this.store.clearApiKey(provider as PrismaIntegrationProvider);
  }

  encryptionAvailable() {
    return isIntegrationEncryptionConfigured(this.environment.APP_ENCRYPTION_KEY);
  }
}

export async function resolveOpenAIConfiguration(service = new IntegrationSettingsService()) {
  const configuration = await service.resolve(IntegrationProvider.OPENAI);
  return { ...configuration, model: configuration.model ?? "gpt-5-mini" };
}

export async function resolveCoinGeckoApiKey(service = new IntegrationSettingsService()) {
  return (await service.resolve(IntegrationProvider.COINGECKO)).apiKey ?? undefined;
}

export async function resolveTwelveDataApiKey(service = new IntegrationSettingsService()) {
  return (await service.resolve(IntegrationProvider.TWELVE_DATA)).apiKey ?? undefined;
}

function environmentApiKey(provider: IntegrationProviderName, environment: IntegrationEnvironment) {
  if (provider === IntegrationProvider.OPENAI) return environment.OPENAI_API_KEY?.trim();
  if (provider === IntegrationProvider.COINGECKO) return environment.COINGECKO_API_KEY?.trim();
  return environment.TWELVE_DATA_API_KEY?.trim();
}

function configuredModel(config: Prisma.JsonValue | undefined, environmentModel: string | undefined) {
  const stored = config && typeof config === "object" && !Array.isArray(config) && "model" in config
    ? (config as { model?: unknown }).model
    : undefined;
  const parsedStored = openAIModelSchema.safeParse(stored);
  if (parsedStored.success) return parsedStored.data;
  const parsedEnvironment = openAIModelSchema.safeParse(environmentModel);
  return parsedEnvironment.success ? parsedEnvironment.data : "gpt-5-mini";
}

function suffix(value: string) {
  return value.slice(-4);
}
