import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Eye,
  Landmark,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataQualitySummary, type DataQualityItem } from "@/components/ui/data-quality-summary";
import { PageHeader } from "@/components/ui/page-header";
import type {
  DailyBriefContributor,
  DailyBriefResult,
  DailyBriefStatus,
  StrategyWarning,
} from "@/features/portfolio-engine";
import { getIntelligenceReadModel } from "@/features/intelligence/read-model";
import { formatUtcDate, formatUtcTimestamp } from "@/lib/format/date";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const intelligence = await getIntelligenceReadModel();
  const { brief, currency } = intelligence;
  const qualityItems = buildDataQualityItems(brief, intelligence.marketDataWarning);

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="A deterministic daily portfolio review based on your ledger, strategy, and recorded prices."
        action={<DataQualitySummary items={qualityItems} />}
      />

      <div className="space-y-5">
        <Card className="overflow-hidden p-0">
          <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.12em] text-muted">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Daily brief
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <StatusBadge status={brief.status} />
                <span className="text-sm text-muted">{brief.currentDate ? formatUtcDate(`${brief.currentDate}T00:00:00Z`) : "Today"}</span>
              </div>
              <h2 className="mt-5 max-w-3xl text-xl font-semibold leading-8 text-foreground md:text-2xl">{brief.summary}</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {brief.reasonCodes.map((code) => <ReasonCode key={code} code={code} />)}
              </div>
            </div>
            <div className="text-left text-xs leading-5 text-muted md:text-right">
              <p className="uppercase tracking-wide">Prices updated</p>
              <p className="mt-1 font-medium text-foreground">{formatUtcTimestamp(intelligence.lastUpdated)}</p>
            </div>
          </div>

          <div className="grid border-t border-border md:grid-cols-4">
            <Metric label="Portfolio value" value={moneyOrUnavailable(brief.currentValue, currency)} prominent />
            <Metric label="Value change" value={signedMoneyOrUnavailable(brief.portfolioValueChange, currency)} tone={toneFor(brief.portfolioValueChange)} />
            <Metric label="Daily gain / loss" value={signedMoneyOrUnavailable(brief.dailyGain, currency)} tone={toneFor(brief.dailyGain)} prominent />
            <Metric label="Daily return" value={signedPercentOrUnavailable(brief.dailyReturnPercent)} tone={toneFor(brief.dailyReturnPercent)} prominent />
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <SectionTitle icon={Landmark} title="Daily performance" description={brief.previousDate ? `Compared with ${formatUtcDate(`${brief.previousDate}T00:00:00Z`)}` : "Previous complete observation unavailable"} />
            {brief.unavailableReason ? (
              <Unavailable reason={brief.unavailableReason} />
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <SmallMetric label="External contributions" value={formatDecimalCurrency(brief.externalContributions ?? "0", currency)} />
                <SmallMetric label="External withdrawals" value={formatDecimalCurrency(brief.externalWithdrawals ?? "0", currency)} />
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-muted">Daily gain removes external deposits and withdrawals from the change in portfolio value.</p>
          </Card>

          <Card>
            <SectionTitle icon={Scale} title="Market contributors" description="Price movement on holdings carried from the previous observation." />
            {brief.unavailableReason ? (
              <p className="mt-5 text-sm text-muted">Contributor ranking is unavailable until both valuation points are complete.</p>
            ) : brief.positiveContributors.length === 0 && brief.negativeContributors.length === 0 ? (
              <p className="mt-5 text-sm text-muted">No material asset-level price contribution was recorded.</p>
            ) : (
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <ContributorList title="Positive" contributors={brief.positiveContributors} currency={currency} positive />
                <ContributorList title="Negative" contributors={brief.negativeContributors} currency={currency} />
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <SectionTitle icon={ShieldCheck} title="Strategy changes" description="Changes in configured allocation ranges since the previous observation." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ViolationList title="New violations" warnings={brief.newViolations} empty="No newly triggered violations." tone="warning" />
              <ViolationList title="Resolved" warnings={brief.resolvedViolations} empty="No violations disappeared today." tone="success" />
            </div>
            {brief.allocationChanges.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr><th className="pb-3 font-medium">Class</th><th className="pb-3 font-medium">Previous</th><th className="pb-3 font-medium">Current</th><th className="pb-3 font-medium">Drift change</th><th className="pb-3 text-right font-medium">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {brief.allocationChanges.map((change) => (
                      <tr key={change.assetClass}>
                        <td className="py-3 font-medium text-foreground">{humanize(change.assetClass)}</td>
                        <td className="py-3 tabular-nums text-muted">{formatDecimalPercent(change.previousPercent)}</td>
                        <td className="py-3 tabular-nums text-foreground">{formatDecimalPercent(change.currentPercent)}</td>
                        <td className={cn("py-3 tabular-nums", toneClass(toneFor(change.driftChange)))}>{signedPercentOrUnavailable(change.driftChange)}</td>
                        <td className="py-3 text-right text-xs font-medium text-muted">{humanize(change.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-5 text-sm text-muted">Allocation comparison is unavailable for this daily interval.</p>}
          </Card>

          <Card>
            <SectionTitle icon={TriangleAlert} title="Risk signals" description="Current deterministic concentration and custody facts." />
            <div className="mt-5 space-y-3">
              {brief.riskSignals.length > 0 ? brief.riskSignals.map((signal) => (
                <div key={signal.code} className={cn("flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3", signal.tone === "WARNING" && "border-warning/30")}>
                  <div className="min-w-0"><p className="text-sm text-muted">{signal.label}</p><p className="mt-1 truncate text-sm font-medium text-foreground">{signal.detail}</p></div>
                  <p className={cn("shrink-0 text-lg font-semibold tabular-nums text-foreground", signal.tone === "WARNING" && "text-warning")}>{signal.value}</p>
                </div>
              )) : <p className="text-sm text-muted">No valued holdings are available for concentration signals.</p>}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">These are portfolio facts, not automatic instructions to trade.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: DailyBriefStatus }) {
  const Icon = status === "ACTION" ? CircleAlert : status === "MONITOR" ? Eye : CheckCircle2;
  return <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold", status === "ACTION" && "border-warning/35 bg-warning/10 text-warning", status === "MONITOR" && "border-primary/30 bg-primary/10 text-primary", status === "NO_ACTION" && "border-success/30 bg-success/10 text-success")}><Icon className="h-4 w-4" aria-hidden="true" />{status === "NO_ACTION" ? "NO ACTION" : status}</span>;
}

function ReasonCode({ code }: { code: string }) {
  return <span className="rounded-md bg-surface-strong px-2 py-1 font-mono text-[11px] text-muted">{code}</span>;
}

function Metric({ label, value, tone = "neutral", prominent = false }: { label: string; value: string; tone?: "positive" | "negative" | "neutral"; prominent?: boolean }) {
  return <div className="border-b border-border p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className={cn("mt-2 font-semibold tabular-nums", prominent ? "text-2xl" : "text-xl", toneClass(tone))}>{value}</p></div>;
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-surface p-4"><p className="text-sm text-muted">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{value}</p></div>;
}

function SectionTitle({ icon: Icon, title, description }: { icon: typeof Landmark; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span><div><h2 className="font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm leading-5 text-muted">{description}</p></div></div>;
}

function Unavailable({ reason }: { reason: NonNullable<DailyBriefResult["unavailableReason"]> }) {
  const messages: Record<typeof reason, string> = {
    NO_PREVIOUS_OBSERVATION: "No earlier daily observation is available yet.",
    PREVIOUS_VALUATION_INCOMPLETE: "The previous daily observation is missing one or more required prices.",
    CURRENT_VALUATION_INCOMPLETE: "The current portfolio valuation is incomplete.",
    INCOMPLETE_EXTERNAL_CASHFLOWS: "External cashflows cannot be valued deterministically for this interval.",
    INVALID_PREVIOUS_VALUE: "The previous portfolio value cannot be used as a return baseline.",
  };
  return <div className="mt-5 rounded-lg border border-border bg-surface p-4"><p className="font-medium text-foreground">Unavailable</p><p className="mt-1 text-sm leading-5 text-muted">{messages[reason]}</p><ReasonCode code={reason} /></div>;
}

function ContributorList({ title, contributors, currency, positive = false }: { title: string; contributors: DailyBriefContributor[]; currency: string; positive?: boolean }) {
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p><div className="mt-2 space-y-2">{contributors.length > 0 ? contributors.map((item) => <div key={item.assetId} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2.5"><div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", positive ? "text-success" : "text-destructive")} aria-hidden="true" /><span className="font-medium text-foreground">{item.symbol}</span></div><div className="text-right"><p className={cn("font-medium tabular-nums", positive ? "text-success" : "text-destructive")}>{signedMoneyOrUnavailable(item.contribution, currency)}</p><p className="text-xs tabular-nums text-muted">{signedPercentOrUnavailable(item.priceChangePercent)}</p></div></div>) : <p className="text-sm text-muted">None</p>}</div></div>;
}

function ViolationList({ title, warnings, empty, tone }: { title: string; warnings: StrategyWarning[]; empty: string; tone: "warning" | "success" }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p><div className="mt-2 space-y-2">{warnings.length > 0 ? warnings.map((warning) => <div key={warning.code} className={cn("rounded-lg border bg-surface p-3", tone === "warning" ? "border-warning/30" : "border-success/25")}><p className={cn("font-medium", tone === "warning" ? "text-warning" : "text-success")}>{humanize(warning.code)}</p><p className="mt-1 text-xs text-muted">{formatDecimalPercent(warning.currentPercent)} · limit {formatDecimalPercent(warning.limitPercent)}</p></div>) : <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">{empty}</p>}</div></div>;
}

function buildDataQualityItems(brief: DailyBriefResult, marketWarning: string | null): DataQualityItem[] {
  const items: DataQualityItem[] = [];
  if (brief.unavailableReason) items.push({ message: `Daily comparison unavailable: ${humanize(brief.unavailableReason).toLowerCase()}.` });
  if (brief.isStale) items.push({ message: "At least one current or previous daily price is stale." });
  if (brief.missingPriceSymbols.length > 0) items.push({ message: `Missing valuation prices: ${brief.missingPriceSymbols.join(", ")}.`, tone: "destructive" });
  if (marketWarning) items.push({ message: marketWarning });
  return items;
}

function moneyOrUnavailable(value: string | null, currency: string) { return value === null ? "Unavailable" : formatDecimalCurrency(value, currency); }
function signedMoneyOrUnavailable(value: string | null, currency: string) { if (value === null) return "Unavailable"; return `${decimalSign(value) === 1 ? "+" : ""}${formatDecimalCurrency(value, currency)}`; }
function signedPercentOrUnavailable(value: string | null) { if (value === null) return "Unavailable"; return `${decimalSign(value) === 1 ? "+" : ""}${formatDecimalPercent(value)}`; }
function toneFor(value: string | null): "positive" | "negative" | "neutral" { const sign = value === null ? null : decimalSign(value); return sign === 1 ? "positive" : sign === -1 ? "negative" : "neutral"; }
function toneClass(tone: "positive" | "negative" | "neutral") { return tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground"; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
