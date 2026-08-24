import { AccountType, AssetClass, AssetType, TransactionType } from "@prisma/client";
import { z } from "zod";

export const decimalStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => value !== "" && !Number.isNaN(Number(value)) && Number.isFinite(Number(value)), {
    message: "Must be a valid number.",
  });

export const positiveDecimalStringSchema = decimalStringSchema.refine((value) => Number(value) > 0, {
  message: "Must be greater than 0.",
});

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine((value) => Number(value) >= 0, {
  message: "Must be greater than or equal to 0.",
});

export const assetInputSchema = z.object({
  symbol: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1),
  assetClass: z.enum(AssetClass),
  assetType: z.enum(AssetType),
  currency: z.string().trim().min(3).max(12).transform((value) => value.toUpperCase()),
  externalId: z.string().trim().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const accountInputSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(AccountType),
  description: z.string().trim().nullable().optional(),
});

export const transactionInputSchema = z.object({
  assetId: z.string().min(1),
  accountId: z.string().min(1),
  type: z.enum(TransactionType),
  quantity: positiveDecimalStringSchema,
  pricePerUnit: nonNegativeDecimalStringSchema.nullable().optional(),
  fee: nonNegativeDecimalStringSchema.nullable().optional(),
  currency: z.string().trim().min(3).max(12).transform((value) => value.toUpperCase()),
  executedAt: z.coerce.date(),
  note: z.string().trim().nullable().optional(),
});

export type AssetInput = z.infer<typeof assetInputSchema>;
export type AccountInput = z.infer<typeof accountInputSchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;
