ALTER TYPE "IntegrationProvider" ADD VALUE 'TWELVE_DATA';

CREATE TYPE "AssetQuoteProvider" AS ENUM ('TWELVE_DATA');

ALTER TABLE "Asset"
ADD COLUMN "quoteProvider" "AssetQuoteProvider",
ADD COLUMN "quoteSymbol" TEXT,
ADD COLUMN "quoteMicCode" TEXT;

CREATE INDEX "Asset_quoteProvider_quoteSymbol_quoteMicCode_idx"
ON "Asset"("quoteProvider", "quoteSymbol", "quoteMicCode");

UPDATE "Asset"
SET
  "currency" = 'EUR',
  "quoteProvider" = 'TWELVE_DATA',
  "quoteSymbol" = 'VWCE',
  "quoteMicCode" = 'XETR'
WHERE "symbol" = 'VWCE'
  AND "assetClass" = 'ETF'
  AND NOT EXISTS (
    SELECT 1
    FROM "Transaction"
    WHERE "Transaction"."assetId" = "Asset"."id"
  );
