"use server";

import { previewMarketScenario, previewTransactionScenario } from "@/features/scenarios/read-model";
import type { MarketScenarioFormInput, TransactionScenarioFormInput } from "@/features/scenarios/validation";

export async function previewTransactionScenarioAction(input: TransactionScenarioFormInput) {
  try {
    return { ok: true as const, data: await previewTransactionScenario(input) };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Transaction scenario could not be calculated.",
    };
  }
}

export async function previewMarketScenarioAction(input: MarketScenarioFormInput) {
  try {
    return { ok: true as const, data: await previewMarketScenario(input) };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Market scenario could not be calculated.",
    };
  }
}
