CREATE TABLE "StrategyAssetAllocation" (
    "id" TEXT NOT NULL,
    "strategyAllocationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "targetPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyAssetAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategyAssetAllocation_strategyAllocationId_assetId_key"
  ON "StrategyAssetAllocation"("strategyAllocationId", "assetId");

CREATE INDEX "StrategyAssetAllocation_strategyAllocationId_idx"
  ON "StrategyAssetAllocation"("strategyAllocationId");

CREATE INDEX "StrategyAssetAllocation_assetId_idx"
  ON "StrategyAssetAllocation"("assetId");

ALTER TABLE "StrategyAssetAllocation"
  ADD CONSTRAINT "StrategyAssetAllocation_strategyAllocationId_fkey"
  FOREIGN KEY ("strategyAllocationId") REFERENCES "StrategyAllocation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StrategyAssetAllocation"
  ADD CONSTRAINT "StrategyAssetAllocation_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StrategyAssetAllocation"
  ADD CONSTRAINT "StrategyAssetAllocation_target_percent_range"
  CHECK ("targetPercent" >= 0 AND "targetPercent" <= 100);
