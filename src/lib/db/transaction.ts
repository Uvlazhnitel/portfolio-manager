import { Prisma, type PrismaClient } from "@prisma/client";

export async function runInTransaction<T>(
  db: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(operation);
}

export async function runInSerializableTransaction<T>(
  db: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt < maxAttempts && isPrismaErrorCode(error, "P2034")) continue;
      throw error;
    }
  }

  throw new Error("Serializable transaction retry loop exhausted unexpectedly.");
}

export function isPrismaErrorCode(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
