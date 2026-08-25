import { DashboardClient } from "@/app/dashboard/_components/dashboard-client";
import { PriceRefresh } from "@/components/market-data/price-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { getDashboardReadModel } from "@/features/dashboard/read-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboard = await getDashboardReadModel();
  return (
    <>
      <PageHeader
        title="Portfolio Dashboard"
        description="Long-term allocation, strategy alignment, and your next contribution."
        action={(
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <span className="text-xs text-muted">Last price update {formatTimestamp(dashboard.valuation.lastUpdated)}</span>
            <PriceRefresh />
          </div>
        )}
      />
      <DashboardClient dashboard={dashboard} />
    </>
  );
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "unavailable";
}
