import { PriceRefresh } from "@/components/market-data/price-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { ManualPrices } from "@/app/settings/_components/manual-prices";
import { IntegrationSettings } from "@/app/settings/_components/integration-settings";
import { getIntegrationSettingsReadModel } from "@/features/integrations/read-model";
import { getMarketDataSettingsReadModel } from "@/features/market-data/settings-read-model";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [assets, integrations] = await Promise.all([
    getMarketDataSettingsReadModel(),
    getIntegrationSettingsReadModel(),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Secure integrations, market data sources, and manual price fallbacks."
        action={<PriceRefresh />}
      />
      <div className="space-y-6">
        <IntegrationSettings model={integrations} />
        <ManualPrices assets={assets} />
      </div>
    </>
  );
}
