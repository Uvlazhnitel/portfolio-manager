"use server";

import { previewMarketScenario, previewTransactionScenario } from "@/features/scenarios/read-model";
import type { MarketScenarioFormInput, TransactionScenarioFormInput } from "@/features/scenarios/validation";
import { publicErrorMessage } from "@/lib/public-error";

export async function previewTransactionScenarioAction(input: TransactionScenarioFormInput) {
  try {
    return { ok: true as const, data: await previewTransactionScenario(input) };
  } catch (error) {
    return {
      ok: false as const,
      message: publicErrorMessage(error, "Transaction scenario could not be calculated."),
    };
  }
}

export async function previewMarketScenarioAction(input: MarketScenarioFormInput) {
  try {
    return { ok: true as const, data: await previewMarketScenario(input) };
  } catch (error) {
    return {
      ok: false as const,
      message: publicErrorMessage(error, "Market scenario could not be calculated."),
    };
  }
}
