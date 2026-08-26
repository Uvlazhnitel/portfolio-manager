import { z } from "zod";
import { IntegrationProvider } from "@/lib/domain/enums";

export const apiKeySchema = z.string()
  .trim()
  .min(12, "API key must contain at least 12 characters.")
  .max(512, "API key must not exceed 512 characters.")
  .refine((value) => !/[\s\u0000-\u001F\u007F]/.test(value), "API key must not contain whitespace or control characters.");

export const openAIModelSchema = z.string()
  .trim()
  .min(1, "OpenAI model is required.")
  .max(100, "OpenAI model must not exceed 100 characters.")
  .regex(/^[A-Za-z0-9._:-]+$/, "OpenAI model contains unsupported characters.");

export const saveIntegrationSettingSchema = z.object({
  provider: z.enum(IntegrationProvider),
  apiKey: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    apiKeySchema.optional(),
  ),
  model: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    openAIModelSchema.optional(),
  ),
}).superRefine((value, context) => {
  if (value.provider === IntegrationProvider.COINGECKO && !value.apiKey) {
    context.addIssue({ code: "custom", path: ["apiKey"], message: "CoinGecko API key is required." });
  }
  if (value.provider === IntegrationProvider.TWELVE_DATA && !value.apiKey) {
    context.addIssue({ code: "custom", path: ["apiKey"], message: "Twelve Data API key is required." });
  }
  if (value.provider === IntegrationProvider.ALPHA_VANTAGE && !value.apiKey) {
    context.addIssue({ code: "custom", path: ["apiKey"], message: "Alpha Vantage API key is required." });
  }
  if (value.provider === IntegrationProvider.OPENAI && !value.apiKey && !value.model) {
    context.addIssue({ code: "custom", message: "Enter an OpenAI API key or model to save." });
  }
});

export const integrationProviderSchema = z.enum(IntegrationProvider);

export type SaveIntegrationSettingInput = z.input<typeof saveIntegrationSettingSchema>;
