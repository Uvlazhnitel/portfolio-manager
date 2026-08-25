import { PriceRefresh } from "@/components/market-data/price-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { ManualPrices } from "@/app/settings/_components/manual-prices";
import { IntegrationSettings } from "@/app/settings/_components/integration-settings";
import { getIntegrationSettingsReadModel } from "@/features/integrations/read-model";
import { getMarketDataSettingsReadModel } from "@/features/market-data/settings-read-model";
import { StrategyRepository } from "@/features/strategy/repository";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/currency";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const strategy = await new StrategyRepository().findActiveStrategy();
  const currency = strategy?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const [assets, integrations] = await Promise.all([
    getMarketDataSettingsReadModel(undefined, currency),
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
        <ManualPrices assets={assets} currency={currency} />
      </div>
    </>
  );
}
