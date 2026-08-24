-- Store the latest advisory contribution plan for the single active strategy.
CREATE TABLE "ContributionPlan" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "contributionAmount" DECIMAL(28,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "allocations" JSONB NOT NULL,
    "isCustomized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContributionPlan_strategyId_key" ON "ContributionPlan"("strategyId");
CREATE INDEX "ContributionPlan_updatedAt_idx" ON "ContributionPlan"("updatedAt");

ALTER TABLE "ContributionPlan" ADD CONSTRAINT "ContributionPlan_strategyId_fkey"
FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
