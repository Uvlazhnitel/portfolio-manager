ALTER TYPE "PortfolioRuleType" ADD VALUE 'SINGLE_ASSET_MAX_ALLOCATION';
ALTER TYPE "PortfolioRuleType" ADD VALUE 'CUSTODIAN_MAX_ALLOCATION';

CREATE TYPE "CustodianCategory" AS ENUM ('EXCHANGE', 'BROKER', 'SELF_CUSTODY', 'PHYSICAL', 'BANK', 'OTHER');

CREATE TABLE "Custodian" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CustodianCategory" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Custodian_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Custodian_name_key" ON "Custodian"("name");

ALTER TABLE "Account" ADD COLUMN "custodianId" TEXT;
CREATE INDEX "Account_custodianId_idx" ON "Account"("custodianId");
ALTER TABLE "Account" ADD CONSTRAINT "Account_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Custodian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PortfolioRule" ("id", "strategyId", "type", "enabled", "config", "createdAt", "updatedAt")
SELECT CONCAT('risk_asset_', "id"), "id", 'SINGLE_ASSET_MAX_ALLOCATION', false, '{"maxPercent":"100"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Strategy"
ON CONFLICT ("strategyId", "type") DO NOTHING;

INSERT INTO "PortfolioRule" ("id", "strategyId", "type", "enabled", "config", "createdAt", "updatedAt")
SELECT CONCAT('risk_custodian_', "id"), "id", 'CUSTODIAN_MAX_ALLOCATION', false, '{"maxPercent":"100"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Strategy"
ON CONFLICT ("strategyId", "type") DO NOTHING;
