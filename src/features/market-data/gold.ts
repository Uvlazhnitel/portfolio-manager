import { MarketPriceUnit, type Prisma } from "@prisma/client";
import { decimal } from "@/features/portfolio-engine/decimal";

export const GRAMS_PER_TROY_OUNCE = "31.1034768";
export const PHYSICAL_GOLD_DISPLAY_DECIMAL_PLACES = 4;

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

export function gramsToTroyOunces(grams: Prisma.Decimal | string | number) {
  return decimal(grams).div(GRAMS_PER_TROY_OUNCE);
}

export function troyOuncesToGrams(troyOunces: Prisma.Decimal | string | number) {
  return decimal(troyOunces).mul(GRAMS_PER_TROY_OUNCE);
}

export function pricePerTroyOunce(pricePerGram: Prisma.Decimal | string | number) {
  return decimal(pricePerGram).mul(GRAMS_PER_TROY_OUNCE);
}

export function formatTroyOunces(troyOunces: Prisma.Decimal | string | number) {
  const fixed = decimal(troyOunces)
    .toDecimalPlaces(PHYSICAL_GOLD_DISPLAY_DECIMAL_PLACES)
    .toFixed(PHYSICAL_GOLD_DISPLAY_DECIMAL_PLACES);

  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function formatPhysicalGoldQuantity(grams: Prisma.Decimal | string | number) {
  return `${formatTroyOunces(gramsToTroyOunces(grams))} oz`;
}
