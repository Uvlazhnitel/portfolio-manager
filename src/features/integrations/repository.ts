import "server-only";

import type { IntegrationProvider, IntegrationSetting, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export type IntegrationSettingRecord = IntegrationSetting;

export interface IntegrationSettingsStore {
  find(provider: IntegrationProvider): Promise<IntegrationSettingRecord | null>;
  upsert(input: {
    provider: IntegrationProvider;
    encryptedApiKey?: string;
    apiKeySuffix?: string;
    config: Prisma.InputJsonValue;
  }): Promise<IntegrationSettingRecord>;
  clearApiKey(provider: IntegrationProvider): Promise<IntegrationSettingRecord | null>;
}

export class IntegrationSettingsRepository implements IntegrationSettingsStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  find(provider: IntegrationProvider) {
    return this.db.integrationSetting.findUnique({ where: { provider } });
  }

  upsert(input: {
    provider: IntegrationProvider;
    encryptedApiKey?: string;
    apiKeySuffix?: string;
    config: Prisma.InputJsonValue;
  }) {
    const secretUpdate = input.encryptedApiKey
      ? { encryptedApiKey: input.encryptedApiKey, apiKeySuffix: input.apiKeySuffix }
      : {};
    return this.db.integrationSetting.upsert({
      where: { provider: input.provider },
      update: { config: input.config, ...secretUpdate },
      create: {
        provider: input.provider,
        encryptedApiKey: input.encryptedApiKey,
        apiKeySuffix: input.apiKeySuffix,
        config: input.config,
      },
    });
  }

  async clearApiKey(provider: IntegrationProvider) {
    const existing = await this.find(provider);
    if (!existing) return null;
    return this.db.integrationSetting.update({
      where: { provider },
      data: { encryptedApiKey: null, apiKeySuffix: null },
    });
  }
}
