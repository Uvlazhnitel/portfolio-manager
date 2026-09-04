import { Prisma } from "@prisma/client";

export type SerializedDecimal = string;
export type DecimalValue = { toString(): string };

export function serializeDecimal(value: DecimalValue): SerializedDecimal {
  return value.toString();
}

export function serializeNullableDecimal(value: DecimalValue | null): SerializedDecimal | null {
  return value ? serializeDecimal(value) : null;
}

export function serializeDecimalRecord<T extends Record<string, unknown>>(
  record: T,
  decimalKeys: Array<keyof T>,
) {
  return decimalKeys.reduce<Record<string, unknown>>(
    (serialized, key) => {
      const value = record[key];
      serialized[String(key)] = value instanceof Prisma.Decimal ? serializeDecimal(value) : value;
      return serialized;
    },
    { ...record },
  ) as T;
}
