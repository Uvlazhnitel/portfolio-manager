import OpenAI from "openai";

let client: OpenAI | null = null;

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getAssistantModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
}

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  client ??= new OpenAI({ apiKey });
  return client;
}

export function resetOpenAIClientForTests() {
  client = null;
}
