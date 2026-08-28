ALTER TABLE "Strategy" ADD COLUMN "benchmarkAssetId" TEXT;

UPDATE "Strategy"
SET "benchmarkAssetId" = "Asset"."id"
FROM "Asset"
WHERE "Asset"."symbol" = 'VWCE'
  AND "Strategy"."benchmarkAssetId" IS NULL;

CREATE INDEX "Strategy_benchmarkAssetId_idx" ON "Strategy"("benchmarkAssetId");

ALTER TABLE "Strategy"
ADD CONSTRAINT "Strategy_benchmarkAssetId_fkey"
FOREIGN KEY ("benchmarkAssetId") REFERENCES "Asset"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
