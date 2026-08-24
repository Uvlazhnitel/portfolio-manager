import { PriceRefresh } from "@/components/market-data/price-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { ManualPrices } from "@/app/settings/_components/manual-prices";
import { getMarketDataSettingsReadModel } from "@/features/market-data/settings-read-model";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const assets = await getMarketDataSettingsReadModel();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Base currency, market data sources, and manual price fallbacks."
        action={<PriceRefresh />}
      />
      <ManualPrices assets={assets} />
    </>
  );
}
