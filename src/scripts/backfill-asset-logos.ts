import "dotenv/config";
import { backfillCoinGeckoLogos } from "@/features/assets/coingecko-logo-backfill";
import { getPrismaClient } from "@/lib/db/client";

backfillCoinGeckoLogos()
  .then((result) => {
    console.info(`[assets] scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} missing=${result.missing.length}`);
    if (result.missing.length > 0) console.warn(`[assets] missing logos for: ${result.missing.join(", ")}`);
    for (const warning of result.warnings) console.warn(`[assets] ${warning}`);
  })
  .catch((error) => {
    console.error("[assets] CoinGecko logo backfill failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrismaClient().$disconnect();
  });
