import { randomBytes } from "node:crypto";
import { IntegrationProvider as PrismaIntegrationProvider, type IntegrationSetting, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  IntegrationEncryptionError,
} from "@/features/integrations/crypto";
import { getIntegrationSettingsReadModel } from "@/features/integrations/read-model";
import { IntegrationSettingsRepository, type IntegrationSettingsStore } from "@/features/integrations/repository";
import { IntegrationSettingsService, resolveOpenAIConfiguration } from "@/features/integrations/service";
import { testIntegrationConnection } from "@/features/integrations/test-connection";
import { apiKeySchema, saveIntegrationSettingSchema } from "@/features/integrations/validation";
import { IntegrationProvider } from "@/lib/domain/enums";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";

const masterKey = randomBytes(32).toString("base64");

describe("integration secret encryption", () => {
  it("round-trips a secret and uses a unique IV each time", () => {
    const first = encryptIntegrationSecret("sk-example-secret-123", IntegrationProvider.OPENAI, masterKey);
    const second = encryptIntegrationSecret("sk-example-secret-123", IntegrationProvider.OPENAI, masterKey);

    expect(first).not.toBe(second);
    expect(decryptIntegrationSecret(first, IntegrationProvider.OPENAI, masterKey)).toBe("sk-example-secret-123");
    expect(first).not.toContain("sk-example-secret-123");
  });

  it("rejects tampering, another provider, and another master key", () => {
    const encrypted = encryptIntegrationSecret("sk-example-secret-123", IntegrationProvider.OPENAI, masterKey);
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => decryptIntegrationSecret(tampered, IntegrationProvider.OPENAI, masterKey)).toThrow(IntegrationEncryptionError);
    expect(() => decryptIntegrationSecret(encrypted, IntegrationProvider.COINGECKO, masterKey)).toThrow(IntegrationEncryptionError);
    expect(() => decryptIntegrationSecret(encrypted, IntegrationProvider.OPENAI, randomBytes(32).toString("base64"))).toThrow(IntegrationEncryptionError);
  });

  it("requires a valid base64-encoded 32-byte master key", () => {
    expect(() => encryptIntegrationSecret("sk-example-secret-123", IntegrationProvider.OPENAI, "short"))
      .toThrow("base64-encoded 32-byte");
  });
});

describe("integration runtime configuration", () => {
  it("prefers the encrypted database key and stored model over environment values", async () => {
    const store = new MemoryIntegrationStore();
    const service = new IntegrationSettingsService(store, {
      APP_ENCRYPTION_KEY: masterKey,
      OPENAI_API_KEY: "sk-environment-secret",
      OPENAI_MODEL: "environment-model",
    });
    await service.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-database-secret", model: "database-model" });

    const resolved = await service.resolve(IntegrationProvider.OPENAI);
    expect(resolved).toEqual(expect.objectContaining({
      apiKey: "sk-database-secret",
      source: "DATABASE",
      suffix: "cret",
      model: "database-model",
    }));
  });

  it("falls back to environment, public CoinGecko, and the default OpenAI model", async () => {
    const environmentService = new IntegrationSettingsService(new MemoryIntegrationStore(), {
      OPENAI_API_KEY: "sk-environment-secret",
    });
    expect(await environmentService.resolve(IntegrationProvider.OPENAI)).toEqual(expect.objectContaining({
      apiKey: "sk-environment-secret",
      source: "ENVIRONMENT",
      model: "gpt-5-mini",
    }));
    expect(await environmentService.resolve(IntegrationProvider.COINGECKO)).toEqual(expect.objectContaining({
      apiKey: null,
      source: "PUBLIC",
    }));
  });

  it("applies replacement and deletion immediately without restarting", async () => {
    const store = new MemoryIntegrationStore();
    const environment = { APP_ENCRYPTION_KEY: masterKey, OPENAI_API_KEY: "sk-environment-secret" };
    const service = new IntegrationSettingsService(store, environment);
    await service.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-first-database", model: "gpt-5-mini" });
    expect((await resolveOpenAIConfiguration(service)).apiKey).toBe("sk-first-database");

    await service.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-second-database", model: "gpt-5-mini" });
    expect((await resolveOpenAIConfiguration(service)).apiKey).toBe("sk-second-database");

    await service.clearApiKey(IntegrationProvider.OPENAI);
    expect(await service.resolve(IntegrationProvider.OPENAI)).toEqual(expect.objectContaining({
      apiKey: "sk-environment-secret",
      source: "ENVIRONMENT",
    }));
  });

  it("returns an unavailable status instead of leaking a decryption failure", async () => {
    const store = new MemoryIntegrationStore();
    const configured = new IntegrationSettingsService(store, { APP_ENCRYPTION_KEY: masterKey });
    await configured.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-database-secret", model: "gpt-5-mini" });

    const missingKeyService = new IntegrationSettingsService(store, {});
    const resolved = await missingKeyService.resolve(IntegrationProvider.OPENAI);
    expect(resolved.apiKey).toBeNull();
    expect(resolved.source).toBe("UNAVAILABLE");
    expect(resolved.error).toContain("APP_ENCRYPTION_KEY");
  });

  it("never includes a decrypted secret in the client read model", async () => {
    const service = new IntegrationSettingsService(new MemoryIntegrationStore(), {
      APP_ENCRYPTION_KEY: masterKey,
      OPENAI_API_KEY: "sk-environment-secret",
    });
    const model = await getIntegrationSettingsReadModel(service);
    expect(JSON.stringify(model)).not.toContain("sk-environment-secret");
    expect(model.integrations.find((item) => item.provider === IntegrationProvider.OPENAI)?.suffix).toBe("cret");
  });

  it("rejects invalid API keys and missing encryption configuration", async () => {
    expect(apiKeySchema.safeParse("contains whitespace").success).toBe(false);
    expect(apiKeySchema.safeParse(`valid-${"x".repeat(600)}`).success).toBe(false);
    expect(saveIntegrationSettingSchema.safeParse({ provider: IntegrationProvider.COINGECKO, apiKey: "" }).success).toBe(false);
    await expect(new IntegrationSettingsService(new MemoryIntegrationStore(), {}).save({
      provider: IntegrationProvider.OPENAI,
      apiKey: "sk-database-secret",
      model: "gpt-5-mini",
    })).rejects.toThrow("APP_ENCRYPTION_KEY");
  });

  it("tests connections through injected probes without mutating settings", async () => {
    const store = new MemoryIntegrationStore();
    const service = new IntegrationSettingsService(store, { OPENAI_API_KEY: "sk-environment-secret" });
    const openAIProbe = vi.fn(async () => undefined);
    const result = await testIntegrationConnection(IntegrationProvider.OPENAI, { service, testOpenAI: openAIProbe });
    expect(result.message).toContain("succeeded");
    expect(openAIProbe).toHaveBeenCalledWith("sk-environment-secret", "gpt-5-mini");
    expect(store.writeCount).toBe(0);
  });
});

let testDb: TestDatabase;

describe("integration settings repository", () => {
  beforeAll(async () => { testDb = await createTestDatabase(); });
  afterAll(async () => testDb.cleanup());

  it("persists, replaces, and clears one encrypted setting per provider", async () => {
    const repository = new IntegrationSettingsRepository(testDb.prisma);
    const service = new IntegrationSettingsService(repository, { APP_ENCRYPTION_KEY: masterKey });
    await service.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-persisted-secret", model: "gpt-5-mini" });
    await service.save({ provider: IntegrationProvider.OPENAI, apiKey: "sk-replaced-secret", model: "gpt-5-mini" });

    expect(await testDb.prisma.integrationSetting.count({ where: { provider: PrismaIntegrationProvider.OPENAI } })).toBe(1);
    expect(await service.resolve(IntegrationProvider.OPENAI)).toEqual(expect.objectContaining({ apiKey: "sk-replaced-secret" }));
    await service.clearApiKey(IntegrationProvider.OPENAI);
    expect((await repository.find(PrismaIntegrationProvider.OPENAI))?.encryptedApiKey).toBeNull();
  });
});

class MemoryIntegrationStore implements IntegrationSettingsStore {
  private readonly records = new Map<PrismaIntegrationProvider, IntegrationSetting>();
  writeCount = 0;

  async find(provider: PrismaIntegrationProvider) {
    return this.records.get(provider) ?? null;
  }

  async upsert(input: {
    provider: PrismaIntegrationProvider;
    encryptedApiKey?: string;
    apiKeySuffix?: string;
    config: Prisma.InputJsonValue;
  }) {
    this.writeCount += 1;
    const current = this.records.get(input.provider);
    const now = new Date();
    const record: IntegrationSetting = {
      id: current?.id ?? `setting-${input.provider}`,
      provider: input.provider,
      encryptedApiKey: input.encryptedApiKey ?? current?.encryptedApiKey ?? null,
      apiKeySuffix: input.apiKeySuffix ?? current?.apiKeySuffix ?? null,
      config: input.config as Prisma.JsonValue,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(input.provider, record);
    return record;
  }

  async clearApiKey(provider: PrismaIntegrationProvider) {
    this.writeCount += 1;
    const current = this.records.get(provider);
    if (!current) return null;
    const updated = { ...current, encryptedApiKey: null, apiKeySuffix: null, updatedAt: new Date() };
    this.records.set(provider, updated);
    return updated;
  }
}
