import { Activity, CircleDollarSign, PiggyBank, Target } from "lucide-react";
import { PriceRefresh } from "@/components/market-data/price-refresh";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { getDashboardReadModel } from "@/features/dashboard/read-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboard = await getDashboardReadModel();
  const strategyCount = dashboard.comparisons.length;

  return (
    <>
      <PageHeader
        title="Portfolio Dashboard"
        description="Long-term allocation snapshot and contribution guidance."
        action={<PriceRefresh />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Last updated {formatTimestamp(dashboard.lastUpdated)}</span>
        {dashboard.isPartial ? <Badge tone="warning">Partial valuation</Badge> : <Badge tone="success">All prices available</Badge>}
        {dashboard.hasStalePrices ? <Badge tone="warning">Stale prices</Badge> : null}
      </div>

      {dashboard.warning ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {dashboard.warning}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard
          title="Total portfolio value"
          value={formatCurrency(dashboard.totalValue, dashboard.baseCurrency)}
          description={dashboard.isPartial ? "Available prices only" : `${dashboard.baseCurrency} base`}
          badge={dashboard.isPartial ? "Partial" : "Live"}
          icon={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Strategy compliance"
          value={strategyCount ? `${dashboard.inRangeCount}/${strategyCount}` : "—"}
          description="Asset classes in target range"
          badge={dashboard.inRangeCount === strategyCount && strategyCount > 0 ? "In range" : "Review"}
          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Allocation"
          value={`${strategyCount} classes`}
          description="Current vs target"
          badge={dashboard.isPartial ? "Partial" : "Current"}
          icon={<Target className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard
          title="Suggested next contribution"
          value={dashboard.suggestedAssetClass ?? "On target"}
          description={dashboard.suggestedAssetClass ? "Most underweight class" : "No class below its range"}
          badge={dashboard.isPartial ? "Check prices" : "Engine"}
          icon={<PiggyBank className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Allocation</h2>
              <p className="mt-1 text-sm text-muted">Current allocation against configurable targets.</p>
            </div>
            <Badge tone="primary">{dashboard.baseCurrency} base</Badge>
          </div>

          <div className="mt-6 space-y-5">
            {dashboard.comparisons.map((item) => (
              <div key={item.assetClass}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">{item.assetClass}</span>
                  <span className="text-muted">
                    {formatPercent(item.currentPercent)} current · {formatPercent(item.targetPercent)} target
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-surface-strong">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, Number(item.currentPercent)))}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground/80"
                    style={{ left: `${Math.min(100, Math.max(0, Number(item.targetPercent)))}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-foreground">Suggested next contribution</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            The priority is derived from current allocation drift. A concrete amount can be planned without selling existing assets.
          </p>
          <div className="mt-6 rounded-lg border border-primary/25 bg-primary/10 p-4">
            <p className="text-sm font-medium text-primary">Primary class</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {dashboard.suggestedAssetClass ?? "Allocation in range"}
            </p>
            {dashboard.isPartial ? (
              <p className="mt-2 text-sm text-warning">Recommendation is partial until all holding prices are available.</p>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

function formatCurrency(value: string, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatPercent(value: string) {
  return `${Number(value).toFixed(1)}%`;
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "unavailable";
}
