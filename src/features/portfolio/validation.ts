import { AccountType, AssetClass, AssetType, TransactionType } from "@prisma/client";
import { z } from "zod";

const decimalLikeSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

export const assetInputSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: z.enum(AssetClass),
  assetType: z.enum(AssetType),
  currency: z.string().min(3).max(12),
  externalId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const accountInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(AccountType),
  description: z.string().nullable().optional(),
});

export const transactionInputSchema = z.object({
  assetId: z.string().min(1),
  accountId: z.string().min(1),
  type: z.enum(TransactionType),
  quantity: decimalLikeSchema,
  pricePerUnit: decimalLikeSchema.nullable().optional(),
  fee: decimalLikeSchema.nullable().optional(),
  currency: z.string().min(3).max(12),
  executedAt: z.coerce.date(),
  note: z.string().nullable().optional(),
});

export type AssetInput = z.infer<typeof assetInputSchema>;
export type AccountInput = z.infer<typeof accountInputSchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;
