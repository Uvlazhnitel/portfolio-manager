import { z } from "zod";
import { scenarioBuckets } from "@/features/scenarios/types";

const moneySchema = z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Use a positive EUR amount with at most two decimal places.");
const shockSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const normalized = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "Use a percentage with at most two decimal places." });
    return z.NEVER;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < -100 || numeric > 1000) {
    context.addIssue({ code: "custom", message: "Percentage must be between -100 and 1000." });
    return z.NEVER;
  }
  return normalized;
});

export const transactionScenarioSchema = z.object({
  assetId: z.string().min(1),
  type: z.enum(["BUY", "SELL"]),
  amount: moneySchema,
}).superRefine((value, context) => {
  if (Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
});

export const marketScenarioSchema = z.object({
  shocks: z.object(Object.fromEntries(scenarioBuckets.map((bucket) => [bucket, shockSchema])) as Record<(typeof scenarioBuckets)[number], typeof shockSchema>),
});

export type TransactionScenarioFormInput = z.input<typeof transactionScenarioSchema>;
export type MarketScenarioFormInput = z.input<typeof marketScenarioSchema>;
