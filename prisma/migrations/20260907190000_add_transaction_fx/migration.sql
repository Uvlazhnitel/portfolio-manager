CREATE TYPE "FxRateSource" AS ENUM ('IDENTITY', 'FRANKFURTER', 'MANUAL');

ALTER TABLE "Transaction"
  ADD COLUMN "fxRateToBase" DECIMAL(28,12),
  ADD COLUMN "fxRateSource" "FxRateSource",
  ADD COLUMN "fxRateDate" DATE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_fx_metadata_check"
  CHECK (
    ("fxRateToBase" IS NULL AND "fxRateSource" IS NULL AND "fxRateDate" IS NULL)
    OR
    ("fxRateToBase" > 0 AND "fxRateSource" IS NOT NULL AND "fxRateDate" IS NOT NULL)
  );

UPDATE "Transaction"
SET
  "fxRateToBase" = 1,
  "fxRateSource" = 'IDENTITY',
  "fxRateDate" = "executedAt"::date
WHERE "currency" = 'USD'
  AND "type" NOT IN ('TRANSFER_IN', 'TRANSFER_OUT')
  AND ("pricePerUnit" IS NOT NULL OR "fee" IS NOT NULL);

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
    OR OLD."fxRateToBase" IS DISTINCT FROM NEW."fxRateToBase"
    OR OLD."fxRateSource" IS DISTINCT FROM NEW."fxRateSource"
    OR OLD."fxRateDate" IS DISTINCT FROM NEW."fxRateDate"
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
        AND outgoing."quantity" >= incoming."quantity"
        AND outgoing."currency" = incoming."currency"
        AND outgoing."executedAt" = incoming."executedAt"
        AND outgoing."note" IS NOT DISTINCT FROM incoming."note"
        AND outgoing."pricePerUnit" IS NULL AND incoming."pricePerUnit" IS NULL
        AND outgoing."fee" IS NULL AND incoming."fee" IS NULL
        AND outgoing."fxRateToBase" IS NULL AND incoming."fxRateToBase" IS NULL
        AND outgoing."fxRateSource" IS NULL AND incoming."fxRateSource" IS NULL
        AND outgoing."fxRateDate" IS NULL AND incoming."fxRateDate" IS NULL;
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
        AND outgoing."fee" IS NULL
        AND outgoing."fxRateToBase" IS NOT DISTINCT FROM incoming."fxRateToBase"
        AND outgoing."fxRateSource" IS NOT DISTINCT FROM incoming."fxRateSource"
        AND outgoing."fxRateDate" IS NOT DISTINCT FROM incoming."fxRateDate"
        AND (
          (outgoing."pricePerUnit" IS NOT NULL AND incoming."pricePerUnit" IS NOT NULL)
          OR
          (outgoing."pricePerUnit" IS NULL AND incoming."pricePerUnit" IS NULL)
        );
    END IF;

    IF valid_count <> 1 THEN
      RAISE EXCEPTION 'Transaction group % has invalid % legs', group_id, group_kind;
    END IF;
  END IF;
  RETURN;
END;
$$;
