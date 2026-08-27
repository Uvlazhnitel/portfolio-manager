-- Transaction groups preserve the existing ledger rows while giving paired
-- operations a durable identity and database-enforced shape.
CREATE TYPE "TransactionGroupKind" AS ENUM ('TRANSFER', 'TRADE');

CREATE TABLE "TransactionGroup" (
    "id" TEXT NOT NULL,
    "kind" "TransactionGroupKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransactionGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN "transactionGroupId" TEXT;
CREATE INDEX "Transaction_transactionGroupId_idx" ON "Transaction"("transactionGroupId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transactionGroupId_fkey"
  FOREIGN KEY ("transactionGroupId") REFERENCES "TransactionGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill only exact, one-to-one legacy transfer matches. Ambiguous rows stay
-- nullable and are handled as read-only legacy entries by the application.
CREATE TEMP TABLE "_LegacyTransferPairs" AS
SELECT
  outgoing."id" AS "outId",
  incoming."id" AS "inId",
  'legacy-transfer-' || md5(outgoing."id" || ':' || incoming."id") AS "groupId"
FROM "Transaction" outgoing
JOIN "Transaction" incoming
  ON incoming."type" = 'TRANSFER_IN'
 AND incoming."assetId" = outgoing."assetId"
 AND incoming."quantity" = outgoing."quantity"
 AND incoming."currency" = outgoing."currency"
 AND incoming."executedAt" = outgoing."executedAt"
 AND incoming."note" IS NOT DISTINCT FROM outgoing."note"
 AND incoming."accountId" <> outgoing."accountId"
WHERE outgoing."type" = 'TRANSFER_OUT'
  AND outgoing."transactionGroupId" IS NULL
  AND incoming."transactionGroupId" IS NULL
  AND 1 = (
    SELECT count(*) FROM "Transaction" candidate
    WHERE candidate."type" = 'TRANSFER_IN'
      AND candidate."assetId" = outgoing."assetId"
      AND candidate."quantity" = outgoing."quantity"
      AND candidate."currency" = outgoing."currency"
      AND candidate."executedAt" = outgoing."executedAt"
      AND candidate."note" IS NOT DISTINCT FROM outgoing."note"
      AND candidate."accountId" <> outgoing."accountId"
      AND candidate."transactionGroupId" IS NULL
  )
  AND 1 = (
    SELECT count(*) FROM "Transaction" candidate
    WHERE candidate."type" = 'TRANSFER_OUT'
      AND candidate."assetId" = incoming."assetId"
      AND candidate."quantity" = incoming."quantity"
      AND candidate."currency" = incoming."currency"
      AND candidate."executedAt" = incoming."executedAt"
      AND candidate."note" IS NOT DISTINCT FROM incoming."note"
      AND candidate."accountId" <> incoming."accountId"
      AND candidate."transactionGroupId" IS NULL
  );

INSERT INTO "TransactionGroup" ("id", "kind", "updatedAt")
SELECT "groupId", 'TRANSFER', CURRENT_TIMESTAMP FROM "_LegacyTransferPairs";

UPDATE "Transaction" transaction
SET "transactionGroupId" = pairs."groupId"
FROM "_LegacyTransferPairs" pairs
WHERE transaction."id" = pairs."outId" OR transaction."id" = pairs."inId";

DROP TABLE "_LegacyTransferPairs";

CREATE OR REPLACE FUNCTION "prevent_new_ungrouped_transfer_leg"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IN ('TRANSFER_IN', 'TRANSFER_OUT') AND NEW."transactionGroupId" IS NULL THEN
    RAISE EXCEPTION 'New transfer legs must belong to a transaction group';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Transaction_require_transfer_group"
BEFORE INSERT OR UPDATE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION "prevent_new_ungrouped_transfer_leg"();

CREATE OR REPLACE FUNCTION "check_transaction_group"(group_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  group_kind "TransactionGroupKind";
  leg_count INTEGER;
  valid_count INTEGER;
BEGIN
  IF group_id IS NOT NULL THEN
    SELECT "kind" INTO group_kind FROM "TransactionGroup" WHERE "id" = group_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    SELECT count(*) INTO leg_count FROM "Transaction" WHERE "transactionGroupId" = group_id;
    IF leg_count <> 2 THEN
      RAISE EXCEPTION 'Transaction group % must contain exactly two legs', group_id;
    END IF;

    IF group_kind = 'TRANSFER' THEN
      SELECT count(*) INTO valid_count
      FROM "Transaction" outgoing
      JOIN "Transaction" incoming ON incoming."transactionGroupId" = outgoing."transactionGroupId"
      WHERE outgoing."transactionGroupId" = group_id
        AND outgoing."type" = 'TRANSFER_OUT'
        AND incoming."type" = 'TRANSFER_IN'
        AND outgoing."accountId" <> incoming."accountId"
        AND outgoing."assetId" = incoming."assetId"
        AND outgoing."quantity" = incoming."quantity"
        AND outgoing."currency" = incoming."currency"
        AND outgoing."executedAt" = incoming."executedAt"
        AND outgoing."note" IS NOT DISTINCT FROM incoming."note"
        AND outgoing."pricePerUnit" IS NULL AND incoming."pricePerUnit" IS NULL
        AND outgoing."fee" IS NULL AND incoming."fee" IS NULL;
    ELSE
      SELECT count(*) INTO valid_count
      FROM "Transaction" outgoing
      JOIN "Transaction" incoming ON incoming."transactionGroupId" = outgoing."transactionGroupId"
      WHERE outgoing."transactionGroupId" = group_id
        AND outgoing."type" = 'SELL'
        AND incoming."type" = 'BUY'
        AND outgoing."assetId" <> incoming."assetId"
        AND outgoing."currency" = incoming."currency"
        AND outgoing."executedAt" = incoming."executedAt"
        AND outgoing."note" IS NOT DISTINCT FROM incoming."note"
        AND outgoing."pricePerUnit" IS NOT NULL
        AND incoming."pricePerUnit" IS NOT NULL
        AND outgoing."fee" IS NULL;
    END IF;

    IF valid_count <> 1 THEN
      RAISE EXCEPTION 'Transaction group % has invalid % legs', group_id, group_kind;
    END IF;
  END IF;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_transaction_group_from_leg"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM "check_transaction_group"(NEW."transactionGroupId"); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM "check_transaction_group"(OLD."transactionGroupId"); END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_transaction_group_from_group"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM "check_transaction_group"(NEW."id"); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM "check_transaction_group"(OLD."id"); END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Transaction_group_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_transaction_group_from_leg"();

CREATE CONSTRAINT TRIGGER "TransactionGroup_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "TransactionGroup"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_transaction_group_from_group"();
