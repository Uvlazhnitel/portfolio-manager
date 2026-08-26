ALTER TYPE "IntegrationProvider" ADD VALUE 'ALPHA_VANTAGE';

ALTER TYPE "AssetQuoteProvider" ADD VALUE 'ALPHA_VANTAGE';

UPDATE "Asset"
SET
  "quoteProvider" = 'ALPHA_VANTAGE',
  "quoteSymbol" = 'VWCE.DEX',
  "quoteMicCode" = 'XETR',
  "currency" = 'EUR',
  "updatedAt" = now()
WHERE
  "symbol" = 'VWCE'
  AND "assetType" = 'ETF'
  AND "quoteProvider" = 'TWELVE_DATA'
  AND "quoteSymbol" = 'VWCE'
  AND "quoteMicCode" = 'XETR';
