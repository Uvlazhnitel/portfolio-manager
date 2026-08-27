ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'GIFT';

CREATE TYPE "BasisMethod" AS ENUM ('KNOWN_COST', 'UNKNOWN', 'ZERO_COST', 'FAIR_VALUE');

ALTER TABLE "Transaction" ADD COLUMN "basisMethod" "BasisMethod";

UPDATE "Transaction"
SET "basisMethod" = CASE
  WHEN "pricePerUnit" IS NULL THEN 'UNKNOWN'::"BasisMethod"
  ELSE 'KNOWN_COST'::"BasisMethod"
END
WHERE "type"::text = 'INITIAL_BALANCE';

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_basis_method_shape_check" CHECK (
  (
    "type"::text = 'INITIAL_BALANCE'
    AND "basisMethod" IS NOT NULL
    AND (
      ("basisMethod" = 'KNOWN_COST' AND "pricePerUnit" IS NOT NULL)
      OR ("basisMethod" = 'UNKNOWN' AND "pricePerUnit" IS NULL AND "fee" IS NULL)
    )
  )
  OR (
    "type"::text = 'GIFT'
    AND "basisMethod" IS NOT NULL
    AND (
      ("basisMethod" = 'ZERO_COST' AND "pricePerUnit" = 0 AND "fee" IS NULL)
      OR ("basisMethod" = 'FAIR_VALUE' AND "pricePerUnit" IS NOT NULL AND "pricePerUnit" > 0 AND "fee" IS NULL)
    )
  )
  OR (
    "type"::text NOT IN ('INITIAL_BALANCE', 'GIFT')
    AND "basisMethod" IS NULL
  )
);
