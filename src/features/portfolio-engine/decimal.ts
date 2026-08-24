import { Prisma } from "@prisma/client";
import type { DecimalLike } from "@/features/portfolio-engine/types";

export const ZERO = new Prisma.Decimal(0);
export const ONE_HUNDRED = new Prisma.Decimal(100);

export function decimal(value: DecimalLike) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function toDecimalString(value: Prisma.Decimal, places = 2) {
  return value.toDecimalPlaces(places).toFixed(places);
}

export function toQuantityString(value: Prisma.Decimal) {
  return value.toString();
}

export function isZero(value: Prisma.Decimal) {
  return value.equals(ZERO);
}

export function maxDecimal(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.greaterThan(right) ? left : right;
}
