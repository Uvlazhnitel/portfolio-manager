-- USD is the sole base currency for this MVP. Transaction currencies and
-- monetary inputs are historical facts and are intentionally left unchanged.
UPDATE "Strategy"
SET "baseCurrency" = 'USD', "updatedAt" = CURRENT_TIMESTAMP
WHERE "baseCurrency" <> 'USD';

DELETE FROM "CachedMarketPrice"
WHERE "currency" <> 'USD';

DELETE FROM "ContributionPlan"
WHERE "currency" <> 'USD';
