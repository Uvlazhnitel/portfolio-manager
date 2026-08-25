"use server";

import { revalidatePath } from "next/cache";
import { IntegrationConnectionError, testIntegrationConnection } from "@/features/integrations/test-connection";
import { IntegrationSettingsService } from "@/features/integrations/service";
import { integrationProviderSchema } from "@/features/integrations/validation";
import { resetMarketDataRuntimeCache } from "@/features/market-data/service";
import { publicErrorMessage } from "@/lib/public-error";

export type IntegrationActionState = {
  ok: boolean;
  message: string;
};

const initialState: IntegrationActionState = { ok: false, message: "" };

export async function saveIntegrationSettingAction(
  previousState: IntegrationActionState = initialState,
  formData: FormData,
): Promise<IntegrationActionState> {
  void previousState;
  try {
    const service = new IntegrationSettingsService();
    await service.save({
      provider: integrationProviderSchema.parse(String(formData.get("provider") ?? "")),
      apiKey: String(formData.get("apiKey") ?? ""),
      model: String(formData.get("model") ?? ""),
    });
    resetMarketDataRuntimeCache();
    revalidateIntegrationPages();
    return { ok: true, message: "Integration settings saved. The new configuration is active now." };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error, "Integration settings could not be saved.") };
  }
}

export async function testIntegrationConnectionAction(
  previousState: IntegrationActionState = initialState,
  formData: FormData,
): Promise<IntegrationActionState> {
  void previousState;
  try {
    const provider = integrationProviderSchema.parse(String(formData.get("provider") ?? ""));
    const result = await testIntegrationConnection(provider);
    return { ok: true, message: result.message };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error, "Connection test failed.") };
  }
}

export async function deleteIntegrationApiKeyAction(
  previousState: IntegrationActionState = initialState,
  formData: FormData,
): Promise<IntegrationActionState> {
  void previousState;
  try {
    const provider = integrationProviderSchema.parse(String(formData.get("provider") ?? ""));
    await new IntegrationSettingsService().clearApiKey(provider);
    resetMarketDataRuntimeCache();
    revalidateIntegrationPages();
    return { ok: true, message: "Stored API key deleted. The configured fallback is active now." };
  } catch (error) {
    return { ok: false, message: integrationErrorMessage(error, "Stored API key could not be deleted.") };
  }
}

function revalidateIntegrationPages() {
  revalidatePath("/settings");
  revalidatePath("/assistant");
  revalidatePath("/dashboard");
  revalidatePath("/portfolio");
}

function integrationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof IntegrationConnectionError) return error.message;
  if (error instanceof Error && error.message.startsWith("APP_ENCRYPTION_KEY")) return error.message;
  return publicErrorMessage(error, fallback);
}
