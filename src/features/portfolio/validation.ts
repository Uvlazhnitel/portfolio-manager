import { AccountType, AssetClass, AssetType, Prisma, TransactionType } from "@prisma/client";
import { z } from "zod";

function decimalInputSchema({ integerDigits, decimalPlaces }: { integerDigits: number; decimalPlaces: number }) {
  return z.union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value), {
      message: "Must be a plain non-negative decimal number.",
    })
    .refine((value) => {
      const [integer, fraction = ""] = value.split(".");
      return integer.length <= integerDigits && fraction.length <= decimalPlaces;
    }, {
      message: `Must have at most ${integerDigits} integer digits and ${decimalPlaces} decimal places.`,
    });
}

export const decimalStringSchema = decimalInputSchema({ integerDigits: 20, decimalPlaces: 18 });
const quantityDecimalStringSchema = decimalInputSchema({ integerDigits: 18, decimalPlaces: 18 });
const moneyDecimalStringSchema = decimalInputSchema({ integerDigits: 20, decimalPlaces: 8 });

export const positiveDecimalStringSchema = quantityDecimalStringSchema.refine((value) => new Prisma.Decimal(value).greaterThan(0), {
  message: "Must be greater than 0.",
});

export const nonNegativeDecimalStringSchema = moneyDecimalStringSchema;
export const positiveMarketPriceStringSchema = moneyDecimalStringSchema.refine(
  (value) => new Prisma.Decimal(value).greaterThan(0),
  { message: "Must be greater than 0." },
);

export const assetInputSchema = z.object({
  symbol: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  assetClass: z.enum(AssetClass),
  assetType: z.enum(AssetType),
  currency: z.string().trim().min(3).max(12).transform((value) => value.toUpperCase()),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
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
