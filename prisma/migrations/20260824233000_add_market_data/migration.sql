-- CreateEnum
CREATE TYPE "MarketPriceUnit" AS ENUM ('ASSET_UNIT', 'GRAM', 'TROY_OUNCE');

-- CreateTable
CREATE TABLE "CachedMarketPrice" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(28,8) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CachedMarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualMarketPrice" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(28,8) NOT NULL,
    "unit" "MarketPriceUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualMarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CachedMarketPrice_assetId_currency_key" ON "CachedMarketPrice"("assetId", "currency");
CREATE INDEX "CachedMarketPrice_currency_idx" ON "CachedMarketPrice"("currency");
CREATE INDEX "CachedMarketPrice_fetchedAt_idx" ON "CachedMarketPrice"("fetchedAt");
CREATE UNIQUE INDEX "ManualMarketPrice_assetId_currency_key" ON "ManualMarketPrice"("assetId", "currency");
CREATE INDEX "ManualMarketPrice_currency_idx" ON "ManualMarketPrice"("currency");

-- AddForeignKey
ALTER TABLE "CachedMarketPrice" ADD CONSTRAINT "CachedMarketPrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualMarketPrice" ADD CONSTRAINT "ManualMarketPrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
