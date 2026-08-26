CREATE TABLE "DailyMarketPrice" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(28,8) NOT NULL,
    "source" TEXT NOT NULL,
    "quoteTimestamp" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "isStaleAtCapture" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMarketPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyMarketPrice_assetId_currency_date_key" ON "DailyMarketPrice"("assetId", "currency", "date");
CREATE INDEX "DailyMarketPrice_currency_date_idx" ON "DailyMarketPrice"("currency", "date");
CREATE INDEX "DailyMarketPrice_date_idx" ON "DailyMarketPrice"("date");

ALTER TABLE "DailyMarketPrice" ADD CONSTRAINT "DailyMarketPrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
