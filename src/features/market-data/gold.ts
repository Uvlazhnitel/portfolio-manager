import { MarketPriceUnit, type Prisma } from "@prisma/client";
import { decimal } from "@/features/portfolio-engine/decimal";

export const GRAMS_PER_TROY_OUNCE = "31.1034768";

export type GoldSpotQuote = {
  price: Prisma.Decimal | string | number;
  currency: string;
  unit: Extract<MarketPriceUnit, "GRAM" | "TROY_OUNCE">;
  timestamp: Date;
  source: string;
};

export interface GoldSpotPriceProvider {
  getCurrentGoldPrice(currency: string): Promise<GoldSpotQuote | null>;
}

export function goldPricePerGram(
  price: Prisma.Decimal | string | number,
  unit: Extract<MarketPriceUnit, "GRAM" | "TROY_OUNCE">,
) {
  const value = decimal(price);
  return unit === MarketPriceUnit.TROY_OUNCE
    ? value.div(GRAMS_PER_TROY_OUNCE)
    : value;
}
