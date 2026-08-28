import "dotenv/config";
import { reconcileEthOpeningBalance } from "@/features/portfolio/eth-reconciliation";
import { getPrismaClient } from "@/lib/db/client";

const prisma = getPrismaClient();

reconcileEthOpeningBalance(prisma)
  .then((result) => {
    console.info(`[portfolio] ETH opening balance reconciled transactionId=${result.transactionId} changed=${result.changed}`);
    console.info(`[portfolio] quantity=${result.summary.quantity} ETH price=${result.summary.pricePerUnit} ${result.summary.currency}/ETH basis=${result.summary.totalBasis} ${result.summary.currency}`);
  })
  .catch((error) => {
    console.error("[portfolio] ETH opening balance reconciliation failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
