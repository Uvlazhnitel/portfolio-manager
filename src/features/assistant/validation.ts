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
  kind: z.enum(["BUY", "SELL", "CONTRIBUTION"]),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Amount must be a positive number with at most two decimals."),
  accountName: z.string().trim().min(1).max(100).nullable(),
}).superRefine((value, context) => {
  if (Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
});

export type AssistantMessageInput = z.input<typeof assistantMessageSchema>;
