import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { IntegrationProvider } from "@/lib/domain/enums";
import type { DbClient } from "@/lib/db/types";

export type IntegrationSettingRecord = {
  id: string;
  provider: IntegrationProvider;
  encryptedApiKey: string | null;
  apiKeySuffix: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationConfig = Record<string, string | null>;

export interface IntegrationSettingsStore {
  find(provider: IntegrationProvider): Promise<IntegrationSettingRecord | null>;
  upsert(input: {
    provider: IntegrationProvider;
    encryptedApiKey?: string;
    apiKeySuffix?: string;
    config: IntegrationConfig;
  }): Promise<IntegrationSettingRecord>;
  clearApiKey(provider: IntegrationProvider): Promise<IntegrationSettingRecord | null>;
}

export class IntegrationSettingsRepository implements IntegrationSettingsStore {
  constructor(private readonly db: DbClient = prisma) {}

  find(provider: IntegrationProvider) {
    return this.db.integrationSetting.findUnique({ where: { provider } });
  }

  upsert(input: {
    provider: IntegrationProvider;
    encryptedApiKey?: string;
    apiKeySuffix?: string;
    config: IntegrationConfig;
  }) {
    const secretUpdate = input.encryptedApiKey
      ? { encryptedApiKey: input.encryptedApiKey, apiKeySuffix: input.apiKeySuffix }
      : {};
    return this.db.integrationSetting.upsert({
      where: { provider: input.provider },
      update: { config: input.config as Prisma.InputJsonValue, ...secretUpdate },
      create: {
        provider: input.provider,
        encryptedApiKey: input.encryptedApiKey,
        apiKeySuffix: input.apiKeySuffix,
        config: input.config as Prisma.InputJsonValue,
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
