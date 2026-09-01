"use client";

import { useActionState, useState, type ReactNode } from "react";
import { CalendarDays, ChartNoAxesCombined, CircleDollarSign, Landmark, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChartRangeSelector, chartRangeLabel, defaultChartRange, filterChartRowsByRange, type ChartRange } from "@/components/ui/chart-range-selector";
import { DataQualitySummary, type DataQualityItem } from "@/components/ui/data-quality-summary";
import { PnlIndicator } from "@/components/ui/pnl-indicator";
import { updatePerformanceBenchmarkAction, type BenchmarkActionState } from "@/features/performance/actions";
import type { PerformanceReadModel } from "@/features/performance/read-model";
import type {
  AdvancedMetricUnavailableReason,
  AdvancedPerformanceMetric,
  PeriodPerformance,
  PeriodPerformanceUnavailableReason,
} from "@/features/portfolio-engine";
import { formatDecimalCurrency } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

type ChartMode = "VALUE" | "COMPARE";

const initialBenchmarkActionState: BenchmarkActionState = { ok: false, message: "" };

type ChartRow = {
  date: string;
  portfolioValue: number | null;
  netInvested: number;
  investmentGain: number | null;
  isComplete: boolean;
  hasStalePrices: boolean;
  missingPriceSymbols: string[];
};

type ComparisonRow = {
  date: string;
  portfolioIndex: number;
  benchmarkIndex: number;
  portfolioReturnPercent: number;
  benchmarkReturnPercent: number;
  hasStalePrices: boolean;
};

export function PerformanceClient({ performance }: { performance: PerformanceReadModel }) {
  const { summary, currency, advanced, benchmark } = performance;
  const [range, setRange] = useState<ChartRange>(defaultChartRange);
  const [chartMode, setChartMode] = useState<ChartMode>("VALUE");
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
  const visibleChartRows = filterChartRowsByRange(chartRows, range);
  const comparison = advanced.comparisons[range];
  const periodPnl = advanced.periodPnl[range];
  const comparisonRows = comparison.points.map<ComparisonRow>((point) => ({
    date: point.date,
    portfolioIndex: Number(point.portfolioIndex),
    benchmarkIndex: Number(point.benchmarkIndex),
    portfolioReturnPercent: Number(point.portfolioReturnPercent),
    benchmarkReturnPercent: Number(point.benchmarkReturnPercent),
    hasStalePrices: point.hasStalePrices,
  }));

  return (
    <div className="space-y-4">
      {dataQualityItems.length > 0 ? <div className="flex justify-end"><DataQualitySummary items={dataQualityItems} /></div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric icon={Landmark} label="Portfolio value" value={formatDecimalCurrency(summary.portfolioValue, currency)} />
        <SummaryMetric icon={CircleDollarSign} label="Net invested" value={formatDecimalCurrency(summary.netInvested, currency)} isPartial={summary.isNetInvestedPartial} />
        <SummaryMetric icon={TrendingUp} label="Investment gain" value={<PnlIndicator value={summary.investmentGain} format="currency" currency={currency} size="lg" variant="text" />} isPartial={summary.isCostBasisPartial} />
        <SummaryMetric icon={ChartNoAxesCombined} label="Return on tracked capital" value={<PnlIndicator value={summary.trackedCapitalReturnPercent} format="percent" size="lg" variant="text" />} isPartial={summary.isCostBasisPartial} />
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
        <AdvancedMetric label="TWR" metric={advanced.twr} />
        <AdvancedMetric label="XIRR (annualized)" metric={advanced.xirr} />
        <AdvancedMetric label="YTD" metric={advanced.ytdReturn} />
        <AdvancedMetric label="1Y" metric={advanced.oneYearReturn} />
        <AdvancedMetric label="Max drawdown" metric={advanced.maxDrawdown} />
      </div>

      <Card className="min-w-0">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {chartMode === "VALUE" ? "Value and net invested" : `Portfolio vs ${benchmark.selectedSymbol ?? "benchmark"}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {chartMode === "VALUE"
                ? "Daily observations at UTC day-end from the moment tracking was enabled."
                : "Cashflow-adjusted portfolio return and benchmark price return, normalized to 100."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <ChartModeSelector value={chartMode} onChange={setChartMode} />
            <BenchmarkSelector performance={performance} />
            <ChartRangeSelector value={range} onChange={setRange} />
            <Badge tone="primary"><CalendarDays className="mr-1 h-3.5 w-3.5" />{chartRangeLabel(range, performance.trackingStartedAt, formatDate)}</Badge>
            {performance.staleDates > 0 || summary.hasStalePrices || comparison.isStale ? <Badge tone="warning">Stale prices present</Badge> : null}
          </div>
        </div>

        <PeriodPnlSummary period={periodPnl} range={range} currency={currency} />

        {chartMode === "VALUE" ? (
          visibleChartRows.length > 0 ? (
            <div className="mt-6 h-[340px] w-full min-w-0 sm:h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
          ) : <ChartEmptyState />
        ) : comparisonRows.length > 0 ? (
          <div className="mt-6 h-[340px] w-full min-w-0 sm:h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#282d3d" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} stroke="#8d93a7" tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={(value) => Number(value).toFixed(0)} stroke="#8d93a7" tickLine={false} axisLine={false} width={52} />
                <Tooltip content={({ active, payload }) => <ComparisonTooltip active={active} row={payload?.[0]?.payload as ComparisonRow | undefined} benchmarkSymbol={benchmark.selectedSymbol ?? "Benchmark"} />} />
                <Legend wrapperStyle={{ paddingTop: 16 }} />
                <Line type="monotone" dataKey="portfolioIndex" name="Portfolio" stroke="#8b5cf6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="benchmarkIndex" name={benchmark.selectedSymbol ?? "Benchmark"} stroke="#38bdf8" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ComparisonEmptyState reason={comparison.unavailableReason} />
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
      <p className="text-sm leading-6 text-muted">Net invested is BUY cost plus fees minus SELL proceeds after fees. Internal trades and transfers, deposits, withdrawals, gifts, and opening balances do not change it. TWR removes deposits and withdrawals; XIRR uses their actual dates. Opening and gift basis remain separate.</p>
    </div>
  );
}

function BenchmarkSelector({ performance }: { performance: PerformanceReadModel }) {
  const [state, action, pending] = useActionState(updatePerformanceBenchmarkAction, initialBenchmarkActionState);
  const { benchmark } = performance;
  return (
    <form action={action} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="strategyId" value={benchmark.strategyId ?? ""} />
        <label htmlFor="performance-benchmark" className="sr-only">Benchmark</label>
        <select
          key={benchmark.selectedAssetId ?? "none"}
          id="performance-benchmark"
          name="benchmarkAssetId"
          defaultValue={benchmark.selectedAssetId ?? ""}
          disabled={!benchmark.strategyId || pending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="min-h-10 max-w-44 rounded-full border border-border bg-surface px-3 text-xs font-medium text-foreground disabled:opacity-50"
          aria-label="Performance benchmark"
          title={state.message || "Select performance benchmark"}
        >
          <option value="">No benchmark</option>
          {benchmark.options.map((option) => <option key={option.id} value={option.id}>{option.symbol} · {option.name}</option>)}
        </select>
      </div>
      {state.message && !state.ok ? <span role="alert" className="max-w-48 text-xs leading-4 text-destructive">{state.message}</span> : null}
      <span className="sr-only" aria-live="polite">{state.ok ? state.message : ""}</span>
    </form>
  );
}

function ChartModeSelector({ value, onChange }: { value: ChartMode; onChange: (value: ChartMode) => void }) {
  return (
    <div className="inline-flex rounded-full border border-border bg-surface p-1" aria-label="Chart mode">
      {(["VALUE", "COMPARE"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn("min-h-8 rounded-full px-3 text-xs font-medium text-muted transition", value === mode && "bg-primary text-white")}
        >
          {mode === "VALUE" ? "Value" : "Compare"}
        </button>
      ))}
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, value, isPartial = false }: { icon: typeof Landmark; label: string; value: ReactNode; isPartial?: boolean }) {
  return <Card className="min-w-0"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><p className="text-xs uppercase text-muted">{label}</p>{isPartial ? <Badge>Partial</Badge> : null}</div><Icon className="h-5 w-5 shrink-0 text-primary" /></div><p className="mt-5 break-words text-2xl font-semibold">{value}</p></Card>;
}

function AdvancedMetric({ label, metric }: { label: string; metric: AdvancedPerformanceMetric }) {
  const reason = metric.unavailableReason ? advancedMetricReason(metric.unavailableReason) : null;
  return (
    <div className="min-w-0 bg-card px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2"><p className="text-xs uppercase text-muted">{label}</p>{metric.isStale ? <Badge tone="warning">Stale</Badge> : null}</div>
      <div className="mt-2 text-xl font-semibold" title={reason ?? undefined}>
        {metric.value === null ? <span className="text-muted">Unavailable</span> : <PnlIndicator value={metric.value} format="percent" size="lg" variant="text" />}
      </div>
      <p className="mt-1 truncate text-xs text-muted">{metric.value === null ? reason : metricPeriod(metric)}</p>
    </div>
  );
}

function PeriodPnlSummary({
  period,
  range,
  currency,
}: {
  period: PeriodPerformance;
  range: ChartRange;
  currency: string;
}) {
  const reason = period.unavailableReasons.map(periodPerformanceReason).join(" ");
  return (
    <div className="mt-5 flex flex-col gap-4 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-muted">Period P&amp;L · {range === "ALL" ? "All" : range}</p>
          {period.state === "PARTIAL" ? <Badge>Partial</Badge> : null}
          {period.isStale ? <Badge tone="warning">Stale</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="text-[11px] text-muted">Money</p>
            <PnlIndicator value={period.amount} format="currency" currency={currency} size="lg" variant="text" />
          </div>
          <div>
            <p className="text-[11px] text-muted">TWR</p>
            <PnlIndicator value={period.returnPercent} format="percent" size="lg" variant="text" />
          </div>
        </div>
      </div>
      <div className="max-w-lg text-left text-xs leading-5 text-muted sm:text-right">
        <p>{period.startDate && period.endDate ? `${formatDate(period.startDate)} – ${formatDate(period.endDate)}` : "Period unavailable"}</p>
        {reason ? <p className="mt-1">{reason}</p> : null}
        {period.excludedSymbols.length > 0 ? <p className="mt-1">Excluded: {period.excludedSymbols.join(", ")}</p> : null}
      </div>
    </div>
  );
}

function PerformanceTooltip({ active, row, currency }: { active?: boolean; row?: ChartRow; currency: string }) {
  if (!active || !row) return null;
  return <div className="max-w-64 rounded-lg border border-border bg-card p-3 shadow-xl"><p className="font-medium text-foreground">{formatDate(row.date)}</p>{row.isComplete ? <div className="mt-3 space-y-2 text-sm"><TooltipValue label="Portfolio value" value={moneyOrUnavailable(decimalFromNumber(row.portfolioValue), currency)} /><TooltipValue label="Net invested" value={moneyOrUnavailable(decimalFromNumber(row.netInvested), currency)} /><TooltipValue label="Investment gain" value={<PnlIndicator value={decimalFromNumber(row.investmentGain)} format="currency" currency={currency} size="sm" variant="text" />} /></div> : <p className="mt-2 text-sm text-warning">Missing: {row.missingPriceSymbols.join(", ")}</p>}{row.hasStalePrices ? <p className="mt-2 text-xs text-warning">Includes stale observations</p> : null}</div>;
}

function ComparisonTooltip({ active, row, benchmarkSymbol }: { active?: boolean; row?: ComparisonRow; benchmarkSymbol: string }) {
  if (!active || !row) return null;
  return (
    <div className="max-w-64 rounded-lg border border-border bg-card p-3 shadow-xl">
      <p className="font-medium text-foreground">{formatDate(row.date)}</p>
      <div className="mt-3 space-y-2 text-sm">
        <TooltipValue label="Portfolio" value={<PnlIndicator value={String(row.portfolioReturnPercent)} format="percent" size="sm" variant="text" />} />
        <TooltipValue label={benchmarkSymbol} value={<PnlIndicator value={String(row.benchmarkReturnPercent)} format="percent" size="sm" variant="text" />} />
      </div>
      {row.hasStalePrices ? <p className="mt-2 text-xs text-warning">Includes stale observations</p> : null}
    </div>
  );
}

function ChartEmptyState() {
  return <div className="mt-6 border-t border-border py-16 text-center"><ChartNoAxesCombined className="mx-auto h-8 w-8 text-muted" /><p className="mt-4 font-medium text-foreground">Daily tracking has just started</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">The history worker will add the first observation automatically. No earlier prices are estimated or backfilled.</p></div>;
}

function ComparisonEmptyState({ reason }: { reason: AdvancedMetricUnavailableReason | null }) {
  return <div className="mt-6 border-t border-border py-16 text-center"><ChartNoAxesCombined className="mx-auto h-8 w-8 text-muted" /><p className="mt-4 font-medium text-foreground">Comparison unavailable</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{reason ? advancedMetricReason(reason) : "Not enough common portfolio and benchmark observations."}</p></div>;
}

function DetailMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase text-muted">{label}</p><p className="mt-1 font-medium text-foreground">{value}</p></div>; }
function TooltipValue({ label, value }: { label: string; value: ReactNode }) { return <div className="flex items-center justify-between gap-5"><span className="text-muted">{label}</span><span className="font-medium text-foreground">{value}</span></div>; }

function performanceDataQualityItems(performance: PerformanceReadModel): DataQualityItem[] {
  const { summary, advanced } = performance;
  const items: DataQualityItem[] = [];
  if (summary.isPartial) items.push({ message: `Current valuation is partial because prices are missing for: ${summary.missingPriceSymbols.join(", ")}. Covered components still contribute to gain and return.` });
  if (performance.incompleteDates > 0) items.push({ message: `${performance.incompleteDates} historical ${performance.incompleteDates === 1 ? "day has" : "days have"} incomplete price coverage.` });
  if (summary.isNetInvestedPartial) items.push({ message: `Net invested is partial because transaction values are missing for: ${summary.missingNetInvestedSymbols.join(", ")}.` });
  if (summary.isCostBasisPartial) items.push({ message: `Gain and return are partial. Excluded components: ${summary.performanceExclusions.map((item) => `${item.symbol} (${item.reasons.join(", ")})`).join("; ")}.` });
  if (summary.openingBasisUnknownSymbols.length > 0) items.push({ message: `Opening basis is unknown for: ${summary.openingBasisUnknownSymbols.join(", ")}. Valuation is retained, but those components are excluded from gain and return.` });
  if (summary.isExternalCashflowPartial) items.push({ message: `External cashflow totals are partial: ${summary.missingExternalCashflowSymbols.join(", ")} has missing acquisition data.` });
  const unavailableByReason = new Map<AdvancedMetricUnavailableReason, string[]>();
  for (const [label, metric] of [["TWR", advanced.twr], ["XIRR", advanced.xirr], ["YTD", advanced.ytdReturn], ["1Y", advanced.oneYearReturn], ["Max drawdown", advanced.maxDrawdown]] as const) {
    if (!metric.unavailableReason) continue;
    unavailableByReason.set(metric.unavailableReason, [...(unavailableByReason.get(metric.unavailableReason) ?? []), label]);
  }
  for (const [reason, labels] of unavailableByReason) items.push({ message: `${labels.join(", ")} unavailable: ${advancedMetricReason(reason)}` });
  if (advanced.comparisons.ALL.isPartial) items.push({ message: "Benchmark comparison uses only dates with both portfolio and benchmark observations." });
  if (performance.staleDates > 0 || summary.hasStalePrices) items.push({ message: "Some observations include stale prices." });
  return items;
}

function advancedMetricReason(reason: AdvancedMetricUnavailableReason) {
  if (reason === "INSUFFICIENT_HISTORY") return "Not enough historical observations for this period.";
  if (reason === "XIRR_PERIOD_TOO_SHORT") return "XIRR requires at least 30 days of history for meaningful annualization.";
  if (reason === "INCOMPLETE_VALUATION") return "Portfolio valuation is incomplete during this period.";
  if (reason === "INCOMPLETE_EXTERNAL_CASHFLOWS") return "One or more external cashflows cannot be valued deterministically.";
  if (reason === "INVALID_START_VALUE") return "The period does not have a positive, valid starting value.";
  if (reason === "XIRR_NO_SOLUTION") return "The dated cashflows do not produce a valid XIRR solution.";
  if (reason === "XIRR_AMBIGUOUS_SOLUTION") return "The dated cashflows produce more than one possible XIRR.";
  if (reason === "BENCHMARK_NOT_CONFIGURED") return "Select a benchmark to enable comparison.";
  return "There are not enough common benchmark price observations.";
}

function periodPerformanceReason(reason: PeriodPerformanceUnavailableReason) {
  if (reason === "INCOMPLETE_COST_BASIS") return "The money result includes only assets with reliable cost basis.";
  if (reason === "INCONSISTENT_PERFORMANCE_COVERAGE") return "Cost-basis coverage changed during this period, so money P&L is unavailable.";
  return advancedMetricReason(reason);
}

function metricPeriod(metric: AdvancedPerformanceMetric) {
  if (!metric.startDate || !metric.endDate) return "Available history";
  return `${formatShortDate(metric.startDate)} – ${formatShortDate(metric.endDate)}`;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function compactMoney(value: number, currency: string) { return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value); }
function moneyOrUnavailable(value: string | null, currency: string) { return value === null ? "Unavailable" : formatDecimalCurrency(value, currency); }
function decimalFromNumber(value: number | null) { return value === null ? null : String(value); }
