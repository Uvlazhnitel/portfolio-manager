import "server-only";

import OpenAI from "openai";
import { resolveOpenAIConfiguration } from "@/features/integrations/service";

export async function getOpenAIConfiguration() {
  return resolveOpenAIConfiguration();
}

export function createOpenAIClient(apiKey: string) {
  if (!apiKey.trim()) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({ apiKey });
}
