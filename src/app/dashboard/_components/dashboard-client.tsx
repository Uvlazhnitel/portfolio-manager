"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleDollarSign, Clock3, Target, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { contributionClassLabels } from "@/features/contributions/presentation";
import type { DashboardReadModel } from "@/features/dashboard/read-model";
import {
  formatDashboardCurrency as formatCurrency,
  formatDashboardPercent as formatPercent,
} from "@/features/dashboard/presentation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataQualitySummary, type DataQualityItem } from "@/components/ui/data-quality-summary";
import { PnlIndicator } from "@/components/ui/pnl-indicator";
import { decimalSign } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

type TrendRow = {
  date: string;
  portfolioValue: number | null;
  netInvested: number;
  investmentGain: number | null;
  isComplete: boolean;
  hasStalePrices: boolean;
  missingPriceSymbols: string[];
};

export function DashboardClient({ dashboard }: { dashboard: DashboardReadModel }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
      <OverviewPanel dashboard={dashboard} />
      <ContributionPanel dashboard={dashboard} />
      <AllocationPanel dashboard={dashboard} />
      <TrendPanel dashboard={dashboard} />
    </div>
  );
}

function OverviewPanel({ dashboard }: { dashboard: DashboardReadModel }) {
  const { valuation } = dashboard;

  return (
    <Card className="order-1 min-w-0 xl:col-start-1 xl:row-start-1">
      <SectionHeading eyebrow="Portfolio" title="Current position" icon={<CircleDollarSign className="h-5 w-5" />}>
        <div className="flex items-center gap-2">
          <DataQualitySummary items={dashboardDataQualityItems(dashboard)} />
          <Link href="/performance" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80">
            Performance <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </SectionHeading>

      <p className="mt-7 text-sm text-muted">Portfolio value</p>
      <p className="mt-2 break-words text-4xl font-semibold text-foreground sm:text-5xl">
        {formatCurrency(valuation.totalValue, valuation.currency)}
      </p>

      <dl className="mt-7 grid grid-cols-1 border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-border">
        <OverviewMetric label="Net invested" value={formatCurrency(valuation.netInvested, valuation.currency)} />
        <OverviewMetric label="Investment gain" value={<PnlIndicator value={valuation.investmentGain} format="currency" currency={valuation.currency} size="md" />} />
        <OverviewMetric label="Return on tracked capital" value={<PnlIndicator value={valuation.trackedCapitalReturnPercent} format="percent" size="md" />} />
      </dl>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <OverviewMetric label="Tracked capital" value={formatCurrency(valuation.trackedCapital, valuation.currency)} />
        <OverviewMetric label="Opening basis (known)" value={formatCurrency(valuation.openingBasis, valuation.currency)} />
        <OverviewMetric label="Gift tracking basis" value={formatCurrency(valuation.giftTrackingBasis, valuation.currency)} />
      </dl>
    </Card>
  );
}

function OverviewMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 py-4 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-2 break-words text-lg font-semibold">{value}</dd>
    </div>
  );
}

function TrendPanel({ dashboard }: { dashboard: DashboardReadModel }) {
  const rows = dashboard.history.points.map<TrendRow>((point) => ({
    date: point.date,
    portfolioValue: point.portfolioValue === null ? null : Number(point.portfolioValue),
    netInvested: Number(point.netInvested),
    investmentGain: point.investmentGain === null ? null : Number(point.investmentGain),
    isComplete: point.isComplete,
    hasStalePrices: point.hasStalePrices,
    missingPriceSymbols: point.missingPriceSymbols,
  }));
  const completeRows = rows.filter((row) => row.portfolioValue !== null);

  return (
    <Card className="order-4 min-w-0 xl:col-start-2 xl:row-start-1">
      <SectionHeading eyebrow="History" title="Portfolio trend" icon={<TrendingUp className="h-5 w-5" />}>
        {dashboard.history.trackingStartedAt ? <span className="text-xs text-muted">Since {shortDate(dashboard.history.trackingStartedAt)}</span> : null}
      </SectionHeading>

      {completeRows.length > 1 ? (
        <div className="mt-6 h-[220px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#282d3d" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} stroke="#8e96ad" tickLine={false} axisLine={false} minTickGap={30} fontSize={11} />
              <YAxis tickFormatter={(value) => compactMoney(Number(value), dashboard.valuation.currency)} stroke="#8e96ad" tickLine={false} axisLine={false} width={62} fontSize={11} />
              <Tooltip content={({ active, payload }) => <TrendTooltip active={active} row={payload?.[0]?.payload as TrendRow | undefined} currency={dashboard.valuation.currency} />} />
              <Line type="monotone" dataKey="portfolioValue" stroke="#8b5cf6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
              <Line type="monotone" dataKey="netInvested" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : completeRows.length === 1 ? (
        <div className="mt-6 flex h-[220px] flex-col justify-center border-y border-border">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <div>
              <p className="text-xs text-muted">First daily observation · {shortDate(completeRows[0].date)}</p>
              <p className="mt-2 text-2xl font-semibold">{formatCurrency(String(completeRows[0].portfolioValue), dashboard.valuation.currency)}</p>
            </div>
          </div>
          <div className="mt-6 h-px w-full bg-border" />
          <p className="mt-4 text-xs text-muted">The trend line will appear after the next daily observation.</p>
        </div>
      ) : (
        <div className="mt-6 flex h-[220px] flex-col items-center justify-center border-y border-border text-center">
          <Clock3 className="h-6 w-6 text-muted" />
          <p className="mt-3 font-medium">Waiting for complete daily data</p>
          <p className="mt-2 max-w-xs text-sm leading-5 text-muted">Tracking begins when every held asset has a daily price.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <LegendDot color="bg-primary" label="Portfolio value" />
        <LegendDot color="bg-success" label="Net invested" />
        {dashboard.history.incompleteDates > 0 ? <span className="text-warning">{dashboard.history.incompleteDates} incomplete {dashboard.history.incompleteDates === 1 ? "day" : "days"}</span> : null}
        {dashboard.history.staleDates > 0 ? <span className="text-warning">Stale observations</span> : null}
      </div>
    </Card>
  );
}

function AllocationPanel({ dashboard }: { dashboard: DashboardReadModel }) {
  const status = dashboard.strategyStatus;
  const summary = status.state === "EMPTY"
    ? "No holdings yet"
    : status.attentionCount > 0
      ? `${status.attentionCount} ${status.attentionCount === 1 ? "class needs" : "classes need"} attention`
      : "All classes within range";

  return (
    <Card className="order-3 min-w-0 xl:col-start-1 xl:row-start-2">
      <SectionHeading eyebrow={status.strategyName ?? "Strategy"} title="Allocation versus target" icon={<Target className="h-5 w-5" />}>
        <Link href="/plan/strategy" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80">
          Edit strategy <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </SectionHeading>
      <p className={cn("mt-3 text-sm", status.attentionCount > 0 ? "text-warning" : "text-muted")}>{summary}</p>

      {dashboard.allocation.length > 0 ? (
        <div className="mt-6 divide-y divide-border">
          {dashboard.allocation.map((item) => <AllocationRow key={item.assetClass} item={item} currency={dashboard.valuation.currency} />)}
        </div>
      ) : (
        <div className="mt-6 border-t border-border py-12 text-center text-sm text-muted">Configure an active strategy to compare allocation targets.</div>
      )}
    </Card>
  );
}

function AllocationRow({ item, currency }: { item: DashboardReadModel["allocation"][number]; currency: string }) {
  const current = clampPercent(item.currentPercent);
  const target = clampPercent(item.targetPercent);
  const driftSign = decimalSign(item.driftPercent) ?? 0;
  const drift = `${driftSign > 0 ? "+" : driftSign < 0 ? "−" : ""}${formatPercent(item.driftPercent.replace(/^-/, ""))}`;

  return (
    <div className="grid gap-3 py-4 md:grid-cols-[minmax(110px,0.6fr)_minmax(220px,1.5fr)_auto] md:items-center md:gap-5">
      <div className="min-w-0">
        <p className="font-medium">{contributionClassLabels[item.assetClass]}</p>
        <p className="mt-1 text-xs text-muted">{formatCurrency(item.value, currency)}</p>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-foreground">{formatPercent(item.currentPercent)}</span>
          <span className="text-muted">Target {formatPercent(item.targetPercent)}</span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-surface-strong">
          <div className={cn("h-2 rounded-full", item.status === "IN_RANGE" ? "bg-success" : item.status === "OVERWEIGHT" ? "bg-destructive" : "bg-warning")} style={{ width: `${current}%` }} />
          <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-foreground" style={{ left: `calc(${target}% - 1px)` }} title={`Target ${formatPercent(item.targetPercent)}`} />
        </div>
        <p className="mt-2 text-[11px] text-muted">Range {formatPercent(item.minPercent)}–{formatPercent(item.maxPercent)}</p>
      </div>
      <div className="flex items-center justify-between gap-3 md:block md:min-w-28 md:text-right">
        <StatusLabel status={item.status} />
        <p className="text-sm font-semibold text-foreground md:mt-2">{drift} drift</p>
      </div>
    </div>
  );
}

function ContributionPanel({ dashboard }: { dashboard: DashboardReadModel }) {
  const { amount, projection } = dashboard.contribution;
  const recommendations = projection?.plan.assetRecommendations ?? [];
  const visibleRecommendations = recommendations.slice(0, 3);
  const remaining = recommendations.length - visibleRecommendations.length;
  const href = amount ? `/plan/contributions?amount=${encodeURIComponent(amount)}` : "/plan/contributions";

  return (
    <Card className="order-2 min-w-0 xl:col-start-2 xl:row-start-2">
      <SectionHeading eyebrow="Saved plan" title="Next contribution" icon={<TrendingUp className="h-5 w-5" />} />

      {amount && projection ? (
        <>
          <p className="mt-6 text-3xl font-semibold">{formatCurrency(projection.plan.contributionAmount, dashboard.valuation.currency)}</p>
          <div className="mt-5 divide-y divide-border border-y border-border">
            {visibleRecommendations.map((item) => (
              <div key={item.assetId} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.symbol}</p>
                  <p className="mt-1 truncate text-xs text-muted">{item.name} · {item.percentOfContribution}%</p>
                </div>
                <p className="shrink-0 font-semibold">{formatCurrency(item.amount, dashboard.valuation.currency)}</p>
              </div>
            ))}
          </div>
          {remaining > 0 ? <p className="mt-3 text-xs text-muted">+{remaining} more {remaining === 1 ? "asset" : "assets"} in the saved plan</p> : null}
        </>
      ) : (
        <div className="mt-6 border-y border-border py-10">
          <p className="font-medium">{amount ? "Recommendation unavailable" : "No saved contribution plan"}</p>
          <p className="mt-2 text-sm leading-5 text-muted">{amount ? "Review current prices and strategy targets in the planner." : "Create a concrete buy list for your next investment."}</p>
        </div>
      )}

      <Link href={href} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90">
        Open contribution planner <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}

function SectionHeading({ eyebrow, title, icon, children }: { eyebrow: string; title: string; icon: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <p className="truncate text-xs text-muted">{eyebrow}</p>
        <span className="shrink-0 text-primary">{icon}</span>
      </div>
      <div className="mt-1 flex items-start justify-between gap-4">
        <h2 className="min-w-0 text-lg font-semibold text-foreground">{title}</h2>
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
    </div>
  );
}

function TrendTooltip({ active, row, currency }: { active?: boolean; row?: TrendRow; currency: string }) {
  if (!active || !row) return null;
  return (
    <div className="max-w-64 rounded-lg border border-border bg-card p-3 shadow-xl">
      <p className="font-medium">{longDate(row.date)}</p>
      {row.isComplete ? (
        <div className="mt-3 space-y-2 text-sm">
          <TooltipValue label="Portfolio value" value={formatCurrency(String(row.portfolioValue), currency)} />
          <TooltipValue label="Net invested" value={formatCurrency(String(row.netInvested), currency)} />
          <TooltipValue label="Investment gain" value={<PnlIndicator value={decimalFromNumber(row.investmentGain)} format="currency" currency={currency} size="sm" />} />
        </div>
      ) : <p className="mt-2 text-sm text-warning">Missing: {row.missingPriceSymbols.join(", ")}</p>}
      {row.hasStalePrices ? <p className="mt-2 text-xs text-warning">Includes stale prices</p> : null}
    </div>
  );
}

function TooltipValue({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-5"><span className="text-muted">{label}</span><span className="font-medium">{value}</span></div>;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", color)} />{label}</span>;
}

function StatusLabel({ status }: { status: DashboardReadModel["allocation"][number]["status"] }) {
  const label = status === "IN_RANGE" ? "In range" : status === "OVERWEIGHT" ? "Overweight" : "Underweight";
  const tone = status === "IN_RANGE" ? "success" : status === "OVERWEIGHT" ? "destructive" : "warning";
  return <Badge tone={tone}>{label}</Badge>;
}

function dashboardDataQualityItems(dashboard: DashboardReadModel): DataQualityItem[] {
  const items: DataQualityItem[] = [];
  if (dashboard.valuation.isPartial) items.push({ message: `Missing prices: ${dashboard.valuation.missingPriceSymbols.join(", ")}` });
  if (dashboard.valuation.isCostBasisPartial) items.push({ message: `Partial cost basis: ${dashboard.valuation.missingCostBasisSymbols.join(", ")}` });
  if (dashboard.valuation.hasStalePrices) items.push({ message: "Stale prices included" });
  if (dashboard.valuation.warning) items.push({ message: dashboard.valuation.warning });
  return items;
}

function clampPercent(value: string) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function compactMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function decimalFromNumber(value: number | null) {
  return value === null ? null : String(value);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
