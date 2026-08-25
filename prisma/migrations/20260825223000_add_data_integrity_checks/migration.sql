-- Enforce row-level financial invariants as a second line of defense behind Zod validation.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "Transaction_pricePerUnit_non_negative" CHECK ("pricePerUnit" IS NULL OR "pricePerUnit" >= 0),
  ADD CONSTRAINT "Transaction_fee_non_negative" CHECK ("fee" IS NULL OR "fee" >= 0);

ALTER TABLE "StrategyAllocation"
  ADD CONSTRAINT "StrategyAllocation_percent_order" CHECK (
    "minPercent" >= 0 AND
    "minPercent" <= "targetPercent" AND
    "targetPercent" <= "maxPercent" AND
    "maxPercent" <= 100
  );

ALTER TABLE "CachedMarketPrice"
  ADD CONSTRAINT "CachedMarketPrice_price_positive" CHECK ("price" > 0);

ALTER TABLE "ManualMarketPrice"
  ADD CONSTRAINT "ManualMarketPrice_price_positive" CHECK ("price" > 0);

ALTER TABLE "ContributionPlan"
  ADD CONSTRAINT "ContributionPlan_amount_positive" CHECK ("contributionAmount" > 0);
