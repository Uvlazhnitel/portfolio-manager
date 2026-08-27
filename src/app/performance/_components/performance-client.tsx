"use client";

import { CalendarDays, ChartNoAxesCombined, CircleDollarSign, Landmark, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataQualitySummary, type DataQualityItem } from "@/components/ui/data-quality-summary";
import type { PerformanceReadModel } from "@/features/performance/read-model";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

type ChartRow = {
  date: string;
  portfolioValue: number | null;
  netInvested: number;
  investmentGain: number | null;
  isComplete: boolean;
  hasStalePrices: boolean;
  missingPriceSymbols: string[];
};

export function PerformanceClient({ performance }: { performance: PerformanceReadModel }) {
  const { summary, currency } = performance;
  const dataQualityItems = performanceDataQualityItems(performance);
  const chartRows = performance.history.map<ChartRow>((point) => ({
    date: point.date,
    portfolioValue: point.portfolioValue === null ? null : Number(point.portfolioValue),
    netInvested: Number(point.netInvested),
    investmentGain: point.investmentGain === null ? null : Number(point.investmentGain),
    isComplete: point.isComplete,
    hasStalePrices: point.hasStalePrices,
    missingPriceSymbols: point.missingPriceSymbols,
  }));

  return (
    <div className="space-y-4">
      {dataQualityItems.length > 0 ? <div className="flex justify-end"><DataQualitySummary items={dataQualityItems} /></div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric icon={Landmark} label="Portfolio value" value={formatDecimalCurrency(summary.portfolioValue, currency)} />
        <SummaryMetric icon={CircleDollarSign} label="Net invested" value={formatDecimalCurrency(summary.netInvested, currency)} isPartial={summary.isNetInvestedPartial} />
        <SummaryMetric icon={TrendingUp} label="Investment gain" value={signedMoneyOrUnavailable(summary.investmentGain, currency)} tone={gainTone(summary.investmentGain)} isPartial={summary.isCostBasisPartial} />
        <SummaryMetric icon={ChartNoAxesCombined} label="Return on tracked capital" value={summary.trackedCapitalReturnPercent === null ? "Unavailable" : signedPercent(summary.trackedCapitalReturnPercent)} tone={gainTone(summary.trackedCapitalReturnPercent)} isPartial={summary.isCostBasisPartial} />
      </div>

      <Card className="min-w-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Value and net invested</h2>
            <p className="mt-1 text-sm text-muted">Daily observations at UTC day-end from the moment tracking was enabled.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {performance.trackingStartedAt ? <Badge tone="primary"><CalendarDays className="mr-1 h-3.5 w-3.5" />Since {formatDate(performance.trackingStartedAt)}</Badge> : null}
            {performance.staleDates > 0 || summary.hasStalePrices ? <Badge tone="warning">Stale prices present</Badge> : null}
          </div>
        </div>

        {chartRows.length > 0 ? (
          <div className="mt-6 h-[340px] w-full min-w-0 sm:h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#282d3d" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#8d93a7" tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={(value) => compactMoney(Number(value), currency)} stroke="#8d93a7" tickLine={false} axisLine={false} width={72} />
                <Tooltip content={({ active, payload }) => <PerformanceTooltip active={active} row={payload?.[0]?.payload as ChartRow | undefined} currency={currency} />} />
                <Legend wrapperStyle={{ paddingTop: 16 }} />
                <Line type="monotone" dataKey="portfolioValue" name="Portfolio value" stroke="#8b5cf6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                <Line type="monotone" dataKey="netInvested" name="Net invested" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-6 border-t border-border py-16 text-center">
            <ChartNoAxesCombined className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-4 font-medium text-foreground">Daily tracking has just started</p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">The history worker will add the first observation automatically. No earlier prices are estimated or backfilled.</p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <DetailMetric label="External contributions" value={moneyOrUnavailable(summary.externalContributions, currency)} />
        <DetailMetric label="External withdrawals" value={moneyOrUnavailable(summary.externalWithdrawals, currency)} />
        <DetailMetric label="Net contributed" value={formatDecimalCurrency(summary.netContributed, currency)} />
        <DetailMetric label="Opening basis (known)" value={formatDecimalCurrency(summary.openingBasis, currency)} />
        <DetailMetric label="Gift tracking basis" value={formatDecimalCurrency(summary.giftTrackingBasis, currency)} />
        <DetailMetric label="Tracked capital (covered)" value={formatDecimalCurrency(summary.trackedCapital, currency)} />
      </div>
      <p className="text-sm leading-6 text-muted">Net invested is BUY cost plus fees minus SELL proceeds after fees. Internal trades and transfers, deposits, withdrawals, gifts, and opening balances do not change it. Deposits and withdrawals are external cashflows; opening and gift basis are tracked separately.</p>
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, value, tone = "default", isPartial = false }: { icon: typeof Landmark; label: string; value: string; tone?: "default" | "positive" | "negative"; isPartial?: boolean }) {
  return <Card className="min-w-0"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><p className="text-xs uppercase text-muted">{label}</p>{isPartial ? <Badge>Partial</Badge> : null}</div><Icon className="h-5 w-5 shrink-0 text-primary" /></div><p className={cn("mt-5 break-words text-2xl font-semibold", tone === "positive" && "text-success", tone === "negative" && "text-destructive")}>{value}</p></Card>;
}

function PerformanceTooltip({ active, row, currency }: { active?: boolean; row?: ChartRow; currency: string }) {
  if (!active || !row) return null;
  return <div className="max-w-64 rounded-lg border border-border bg-card p-3 shadow-xl"><p className="font-medium text-foreground">{formatDate(row.date)}</p>{row.isComplete ? <div className="mt-3 space-y-2 text-sm"><TooltipValue label="Portfolio value" value={moneyOrUnavailable(decimalFromNumber(row.portfolioValue), currency)} /><TooltipValue label="Net invested" value={moneyOrUnavailable(decimalFromNumber(row.netInvested), currency)} /><TooltipValue label="Investment gain" value={signedMoneyOrUnavailable(decimalFromNumber(row.investmentGain), currency)} /></div> : <p className="mt-2 text-sm text-warning">Missing: {row.missingPriceSymbols.join(", ")}</p>}{row.hasStalePrices ? <p className="mt-2 text-xs text-warning">Includes stale observations</p> : null}</div>;
}

function DetailMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase text-muted">{label}</p><p className="mt-1 font-medium text-foreground">{value}</p></div>; }

function TooltipValue({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-5"><span className="text-muted">{label}</span><span className="font-medium text-foreground">{value}</span></div>; }
function performanceDataQualityItems(performance: PerformanceReadModel): DataQualityItem[] {
  const { summary } = performance;
  const items: DataQualityItem[] = [];
  if (summary.isPartial) items.push({ message: `Current valuation is partial because prices are missing for: ${summary.missingPriceSymbols.join(", ")}. Covered components still contribute to gain and return.` });
  if (performance.incompleteDates > 0) items.push({ message: `${performance.incompleteDates} historical ${performance.incompleteDates === 1 ? "day has" : "days have"} incomplete price coverage.` });
  if (summary.isNetInvestedPartial) items.push({ message: `Net invested is partial because transaction values are missing for: ${summary.missingNetInvestedSymbols.join(", ")}.` });
  if (summary.isCostBasisPartial) items.push({ message: `Gain and return are partial. Excluded components: ${summary.performanceExclusions.map((item) => `${item.symbol} (${item.reasons.join(", ")})`).join("; ")}.` });
  if (summary.openingBasisUnknownSymbols.length > 0) items.push({ message: `Opening basis is unknown for: ${summary.openingBasisUnknownSymbols.join(", ")}. Valuation is retained, but those components are excluded from gain and return.` });
  if (summary.isExternalCashflowPartial) items.push({ message: `External cashflow totals are partial: ${summary.missingExternalCashflowSymbols.join(", ")} has missing acquisition data.` });
  if (performance.staleDates > 0 || summary.hasStalePrices) items.push({ message: "Some observations include stale prices." });
  return items;
}
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function compactMoney(value: number, currency: string) { return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value); }
function moneyOrUnavailable(value: string | null, currency: string) { return value === null ? "Unavailable" : formatDecimalCurrency(value, currency); }
function signedMoneyOrUnavailable(value: string | null, currency: string) { if (value === null) return "Unavailable"; const formatted = formatDecimalCurrency(value.replace(/^-/, ""), currency); return `${(decimalSign(value) ?? 0) >= 0 ? "+" : "−"}${formatted}`; }
function signedPercent(value: string) { return `${(decimalSign(value) ?? 0) >= 0 ? "+" : "−"}${formatDecimalPercent(value.replace(/^-/, ""), 1)}`; }
function gainTone(value: string | null): "default" | "positive" | "negative" { const sign = value === null ? null : decimalSign(value); return sign === null || sign === 0 ? "default" : sign > 0 ? "positive" : "negative"; }
function decimalFromNumber(value: number | null) { return value === null ? null : String(value); }
