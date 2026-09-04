import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { runInSerializableTransaction } from "@/lib/db/transaction";

describe("database transactions", () => {
  it("retries a serializable write conflict and succeeds on the third attempt", async () => {
    const conflict = prismaError("P2034");
    const transaction = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce("saved");
    const db = { $transaction: transaction } as unknown as PrismaClient;

    await expect(runInSerializableTransaction(db, async () => "unused")).resolves.toBe("saved");
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(transaction.mock.calls.every((call) => call[1]?.isolationLevel === "Serializable")).toBe(true);
  });

  it("does not retry other errors or exceed the configured attempt limit", async () => {
    const regularError = new Error("write failed");
    const regularTransaction = vi.fn().mockRejectedValue(regularError);
    await expect(runInSerializableTransaction(
      { $transaction: regularTransaction } as unknown as PrismaClient,
      async () => "unused",
    )).rejects.toBe(regularError);
    expect(regularTransaction).toHaveBeenCalledOnce();

    const conflictTransaction = vi.fn().mockRejectedValue(prismaError("P2034"));
    await expect(runInSerializableTransaction(
      { $transaction: conflictTransaction } as unknown as PrismaClient,
      async () => "unused",
    )).rejects.toMatchObject({ code: "P2034" });
    expect(conflictTransaction).toHaveBeenCalledTimes(3);
  });
});

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("transaction failed", {
    code,
    clientVersion: "7.9.1",
  });
}
