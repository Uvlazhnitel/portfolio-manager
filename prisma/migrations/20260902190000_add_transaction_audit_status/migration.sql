-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('ACTIVE', 'VOIDED', 'REPLACED');

-- AlterTable
ALTER TABLE "Transaction"
ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "statusChangedAt" TIMESTAMP(3),
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "replacesTransactionId" TEXT;

-- Existing transactions remain ACTIVE through the default above.

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX "Transaction_replacesTransactionId_idx" ON "Transaction"("replacesTransactionId");
CREATE INDEX "Transaction_status_accountId_assetId_executedAt_createdAt_idx" ON "Transaction"("status", "accountId", "assetId", "executedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_replacesTransactionId_fkey"
FOREIGN KEY ("replacesTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit invariants
ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_status_changed_at_required"
CHECK ("status" = 'ACTIVE' OR "statusChangedAt" IS NOT NULL);

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_replaces_self_check"
CHECK ("replacesTransactionId" IS NULL OR "replacesTransactionId" <> "id");

-- Guard rails: app flows must void/replace financial rows instead of mutating/deleting them.
CREATE OR REPLACE FUNCTION prevent_transaction_financial_update()
RETURNS trigger AS $$
BEGIN
  IF OLD."assetId" IS DISTINCT FROM NEW."assetId"
    OR OLD."accountId" IS DISTINCT FROM NEW."accountId"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."basisMethod" IS DISTINCT FROM NEW."basisMethod"
    OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
    OR OLD."pricePerUnit" IS DISTINCT FROM NEW."pricePerUnit"
    OR OLD."fee" IS DISTINCT FROM NEW."fee"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."executedAt" IS DISTINCT FROM NEW."executedAt"
    OR OLD."note" IS DISTINCT FROM NEW."note"
    OR OLD."transactionGroupId" IS DISTINCT FROM NEW."transactionGroupId"
    OR OLD."replacesTransactionId" IS DISTINCT FROM NEW."replacesTransactionId"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Financial transaction rows are immutable; create a replacement transaction instead';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_prevent_financial_update"
BEFORE UPDATE ON "Transaction"
FOR EACH ROW
EXECUTE FUNCTION prevent_transaction_financial_update();

CREATE OR REPLACE FUNCTION prevent_transaction_hard_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Financial transaction rows cannot be hard-deleted; void them instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_prevent_hard_delete"
BEFORE DELETE ON "Transaction"
FOR EACH ROW
EXECUTE FUNCTION prevent_transaction_hard_delete();

CREATE OR REPLACE FUNCTION prevent_transaction_group_hard_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Transaction groups cannot be hard-deleted; void or replace their transaction legs instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransactionGroup_prevent_hard_delete"
BEFORE DELETE ON "TransactionGroup"
FOR EACH ROW
EXECUTE FUNCTION prevent_transaction_group_hard_delete();
