import "server-only";

import { IntegrationSettingsService } from "@/features/integrations/service";
import { IntegrationProvider } from "@/lib/domain/enums";

export async function getIntegrationSettingsReadModel(
  service = new IntegrationSettingsService(),
) {
  const [openAI, coinGecko, twelveData] = await Promise.all([
    service.status(IntegrationProvider.OPENAI),
    service.status(IntegrationProvider.COINGECKO),
    service.status(IntegrationProvider.TWELVE_DATA),
  ]);

  return {
    encryptionAvailable: service.encryptionAvailable(),
    integrations: [openAI, coinGecko, twelveData].map((integration) => ({
      ...integration,
      updatedAt: integration.updatedAt?.toISOString() ?? null,
    })),
  };
}

export type IntegrationSettingsReadModel = Awaited<ReturnType<typeof getIntegrationSettingsReadModel>>;
