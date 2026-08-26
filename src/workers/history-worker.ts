import "dotenv/config";
import { runHistoryWorker } from "@/features/performance/worker";
import { getPrismaClient } from "@/lib/db/client";

let stopping = false;
const stop = () => {
  stopping = true;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

runHistoryWorker({
  shouldStop: () => stopping,
  onSuccess: (result) => {
    console.info(`[history] captured ${result.capturedPrices} prices for ${result.date}`);
    if (result.warning) console.warn(`[history] ${result.warning}`);
  },
  onError: (error) => {
    console.error("[history] capture failed; retrying in five minutes", error);
  },
}).finally(async () => {
  await getPrismaClient().$disconnect();
});
