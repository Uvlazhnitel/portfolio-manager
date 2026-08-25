import { MarketPriceUnit } from "@prisma/client";
import { z } from "zod";
import { positiveMarketPriceStringSchema } from "@/features/portfolio/validation";

export const manualMarketPriceSchema = z.object({
  assetId: z.string().min(1),
  price: positiveMarketPriceStringSchema,
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  unit: z.enum(MarketPriceUnit),
});

export type ManualMarketPriceInput = z.input<typeof manualMarketPriceSchema>;
