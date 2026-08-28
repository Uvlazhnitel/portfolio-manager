import { Plus } from "lucide-react";
import { PortfolioClient } from "@/app/portfolio/_components/portfolio-client";
import { Button } from "@/components/ui/button";
import { PriceRefresh } from "@/components/market-data/price-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { getPortfolioReadModel } from "@/features/portfolio/read-model";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialDialog = params.action === "add-asset" ? "asset" : null;
  const portfolio = await getPortfolioReadModel();

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Real holdings, accounts, and transactions from PostgreSQL."
        action={
          <>
            <PriceRefresh compact />
            <Button form="open-add-asset" type="submit">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add transaction
            </Button>
          </>
        }
      />
      <PortfolioClient key={initialDialog ?? "default"} portfolio={portfolio} initialDialog={initialDialog} />
    </>
  );
}
