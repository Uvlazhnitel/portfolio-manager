import { z } from "zod";

export const assistantMessageSchema = z.object({
  conversationId: z.string().min(1).max(64).nullable().optional(),
  message: z.string().trim().min(1, "Enter a message.").max(4000, "Message must be 4,000 characters or fewer."),
});

export const planContributionToolSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Amount must be a non-negative number with at most two decimals."),
  currency: z.literal("EUR"),
}).superRefine((value, context) => {
  if (Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
});

export const simulateTransactionToolSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  type: z.enum(["BUY", "SELL"]),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Amount must be a positive number with at most two decimals."),
}).superRefine((value, context) => {
  if (Number(value.amount) <= 0) context.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero." });
});

export type AssistantMessageInput = z.input<typeof assistantMessageSchema>;
