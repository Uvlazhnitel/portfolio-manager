import { AccountType, AssetClass, AssetQuoteProvider, AssetType, BasisMethod, Prisma, TransactionType } from "@prisma/client";
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

const quoteProviderSchema = z.enum(AssetQuoteProvider).nullable().optional();
const quoteSymbolSchema = z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()).nullable().optional();
const quoteMicCodeSchema = z.string().trim().length(4).regex(/^[A-Za-z0-9]+$/).transform((value) => value.toUpperCase()).nullable().optional();

export const assetInputSchema = z.object({
  symbol: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  assetClass: z.enum(AssetClass),
  assetType: z.enum(AssetType),
  currency: z.string().trim().min(3).max(12).transform((value) => value.toUpperCase()),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  quoteProvider: quoteProviderSchema,
  quoteSymbol: quoteSymbolSchema,
  quoteMicCode: quoteMicCodeSchema,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).superRefine(validateQuoteIdentity);

export const assetQuoteLinkSchema = z.object({
  assetId: z.string().min(1),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  quoteProvider: z.enum(AssetQuoteProvider),
  quoteSymbol: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  quoteMicCode: quoteMicCodeSchema,
}).superRefine(validateQuoteLinkIdentity);

export const accountInputSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(AccountType),
  description: z.string().trim().nullable().optional(),
  custodianId: z.string().trim().min(1).nullable().optional(),
});

export const transactionInputSchema = z.object({
  assetId: z.string().min(1),
  accountId: z.string().min(1),
  type: z.enum(TransactionType),
  basisMethod: z.enum(BasisMethod).nullable().optional(),
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

function validateQuoteIdentity(value: {
  assetClass: AssetClass;
  assetType: AssetType;
  quoteProvider?: AssetQuoteProvider | null;
  quoteSymbol?: string | null;
  quoteMicCode?: string | null;
}, context: z.RefinementCtx) {
  const hasAny = Boolean(value.quoteProvider || value.quoteSymbol || value.quoteMicCode);
  validateQuoteFields(value, context);
  if (hasAny && (value.assetClass !== AssetClass.ETF || value.assetType !== AssetType.ETF)) {
    context.addIssue({ code: "custom", path: ["quoteProvider"], message: "Automatic exchange quotes are only available for ETF assets." });
  }
}

function validateQuoteLinkIdentity(value: {
  quoteProvider: AssetQuoteProvider;
  quoteSymbol: string;
  quoteMicCode?: string | null;
}, context: z.RefinementCtx) {
  validateQuoteFields(value, context);
}

function validateQuoteFields(value: {
  quoteProvider?: AssetQuoteProvider | null;
  quoteSymbol?: string | null;
  quoteMicCode?: string | null;
}, context: z.RefinementCtx) {
  if (value.quoteMicCode && !value.quoteProvider) {
    context.addIssue({ code: "custom", path: ["quoteProvider"], message: "Quote provider is required when MIC is provided." });
  }
  if (value.quoteProvider && !value.quoteSymbol) {
    context.addIssue({ code: "custom", path: ["quoteSymbol"], message: "Quote symbol is required for automatic exchange quotes." });
  }
  if (value.quoteSymbol && !value.quoteProvider) {
    context.addIssue({ code: "custom", path: ["quoteProvider"], message: "Quote provider is required when quote symbol is provided." });
  }
  if (value.quoteProvider === AssetQuoteProvider.TWELVE_DATA && !value.quoteMicCode) {
    context.addIssue({ code: "custom", path: ["quoteMicCode"], message: "Twelve Data quotes require a MIC." });
  }
}
