-- Allow real trade ledger events to be recorded even when the source lot's
-- acquisition basis is unknown. In that case both trade legs carry NULL prices
-- and Portfolio Engine marks cost basis / P&L as partial until the basis is
-- corrected.
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
        AND outgoing."fee" IS NULL
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
