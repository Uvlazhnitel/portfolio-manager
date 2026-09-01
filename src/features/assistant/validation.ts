import { z } from "zod";

export const assistantMessageSchema = z.object({
  conversationId: z.string().min(1).max(64).nullable().optional(),
  message: z.string().trim().min(1, "Enter a message.").max(4000, "Message must be 4,000 characters or fewer."),
  retryMessageId: z.string().min(1).max(64).nullable().optional(),
}).superRefine((value, context) => {
  if (value.retryMessageId && !value.conversationId) {
    context.addIssue({ code: "custom", path: ["conversationId"], message: "Retry requires an existing conversation." });
  }
});

const optionalMoney = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Amount must be a non-negative number with at most two decimals.").nullable();

export const explainContributionPlanToolSchema = z.object({
  amount: optionalMoney,
}).superRefine((value, context) => {
  if (value.amount !== null && Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
});

export const simulateScenarioToolSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  kind: z.enum(["BUY", "EXTERNAL_BUY", "SELL", "CONTRIBUTION", "TRADE"]),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Amount must be a positive number with at most two decimals."),
  accountName: z.string().trim().min(1).max(100).nullable(),
  sourceSymbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()).nullable().default(null),
  sourceAccountName: z.string().trim().min(1).max(100).nullable().default(null),
  destinationAccountName: z.string().trim().min(1).max(100).nullable().default(null),
  fee: optionalMoney.default(null),
}).superRefine((value, context) => {
  if (Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
  if (value.kind === "TRADE" && value.sourceSymbol === null) context.addIssue({ code: "custom", path: ["sourceSymbol"], message: "Source symbol is required for trade scenarios." });
  if (value.kind !== "TRADE" && value.sourceSymbol !== null) context.addIssue({ code: "custom", path: ["sourceSymbol"], message: "Source symbol is only valid for trade scenarios." });
  if (value.kind !== "TRADE" && value.sourceAccountName !== null) context.addIssue({ code: "custom", path: ["sourceAccountName"], message: "Source account is only valid for trade scenarios." });
  if (value.kind !== "TRADE" && value.destinationAccountName !== null) context.addIssue({ code: "custom", path: ["destinationAccountName"], message: "Destination account is only valid for trade scenarios." });
  if (value.kind !== "TRADE" && value.fee !== null) context.addIssue({ code: "custom", path: ["fee"], message: "Fee is only valid for trade scenarios." });
  if (value.fee !== null && Number(value.fee) >= Number(value.amount)) context.addIssue({ code: "custom", path: ["fee"], message: "Fee must be less than amount." });
});

export type AssistantMessageInput = z.input<typeof assistantMessageSchema>;
