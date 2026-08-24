-- Add the new deterministic strategy preference.
ALTER TYPE "PortfolioRuleType" ADD VALUE 'PREFER_NO_ACTION_WHEN_EVIDENCE_WEAK';

-- Crypto maximum is now sourced exclusively from StrategyAllocation.CRYPTO.maxPercent.
DELETE FROM "PortfolioRule"
WHERE "type" = 'CRYPTO_MAX_ALLOCATION';

-- The editor default is 2 percentage points. Preserve values already customized away from the old seed default.
UPDATE "PortfolioRule"
SET "config" = '{"minDriftPercent":"2"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'MIN_REBALANCE_DRIFT'
  AND COALESCE("config"->>'minDriftPercent', '5') = '5';
