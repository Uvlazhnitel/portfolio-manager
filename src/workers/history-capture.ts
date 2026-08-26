import "dotenv/config";
import { captureDailyMarketPrices } from "@/features/performance/capture";
import { getPrismaClient } from "@/lib/db/client";

captureDailyMarketPrices()
  .then((result) => {
    console.info(`[history] captured ${result.capturedPrices} prices for ${result.date}`);
  })
  .catch((error) => {
    console.error("[history] capture failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrismaClient().$disconnect();
  });
