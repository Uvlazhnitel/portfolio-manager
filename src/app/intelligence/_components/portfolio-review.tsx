import { CheckCircle2, CircleAlert, DatabaseZap, Eye, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { IntelligenceReadModel } from "@/features/intelligence/read-model";
import type { PortfolioReviewState, PortfolioSignal, PortfolioSignalDataQualityState } from "@/features/portfolio-engine";
import { formatUtcDate, formatUtcTimestamp } from "@/lib/format/date";
import { formatDecimalPercent } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

export function PortfolioReviewView({ model }: { model: IntelligenceReadModel }) {
  const { review } = model;
  const nonDataSignals = review.signals.filter((signal) => signal.category !== "DATA_QUALITY");
  const needsReview = nonDataSignals.filter((signal) => signal.state === "NEEDS_REVIEW" && signal.lifecycle !== "RESOLVED");
  const watch = nonDataSignals.filter((signal) => signal.state === "WATCH" && signal.lifecycle !== "RESOLVED");
  const resolved = review.signals.filter((signal) => signal.lifecycle === "RESOLVED");
  const dataSignals = review.signals.filter((signal) => signal.category === "DATA_QUALITY" && signal.lifecycle !== "RESOLVED");
  const previousDate = review.period.previousAsOf ? formatUtcDate(review.period.previousAsOf) : null;

  return (
    <div className="space-y-5">
      <Card className={cn("overflow-hidden border-primary/20 bg-gradient-to-br from-card to-surface p-5 md:p-7", review.state === "CLEAR" && "border-success/25")}>
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Portfolio review
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <ReviewStateBadge state={review.state} />
              <span className="text-sm text-muted">{previousDate ? `Changes since ${previousDate}` : "Current facts · comparison pending"}</span>
            </div>
            <h1 className="mt-5 text-2xl font-semibold text-foreground">{review.state === "CLEAR" ? "Portfolio is clear" : review.summary}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {review.state === "CLEAR"
                ? "No material strategy, risk, custody, or data-quality changes require attention."
                : "Review the evidence below. Signals describe deterministic portfolio facts and are not trading instructions."}
            </p>
          </div>
          <div className="text-left text-xs leading-5 text-muted md:text-right">
            <p className="uppercase tracking-wide">Prices updated</p>
            <p className="mt-1 font-medium text-foreground">{formatUtcTimestamp(model.lastUpdated)}</p>
          </div>
        </div>
      </Card>

      <SignalSection title="Needs review" description="Material rule or risk changes that warrant a deliberate review." signals={needsReview} empty="No material changes currently need review." />
      <SignalSection title="Watch" description="Conditions worth monitoring without implying an immediate portfolio change." signals={watch} empty="No active conditions are on watch." />
      <SignalSection title="Resolved" description="Previously observed conditions that returned within their configured boundaries." signals={resolved} empty="No conditions were resolved in this comparison period." />

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><DatabaseZap className="h-4 w-4" aria-hidden="true" /></span>
            <div>
              <h2 className="font-semibold text-foreground">Data quality</h2>
              <p className="mt-1 text-sm leading-5 text-muted">Coverage and freshness of the observations used for this review.</p>
            </div>
          </div>
          <DataStateBadge state={review.dataQuality.state} />
        </div>
        {review.dataQuality.messages.length > 0 ? (
          <div className="mt-5 space-y-3">
            {review.dataQuality.messages.map((message) => <p key={message} className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</p>)}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">Current and comparison observations are complete and fresh.</p>
        )}
        {dataSignals.length > 0 ? <div className="mt-4 space-y-3">{dataSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div> : null}
      </Card>
    </div>
  );
}

function SignalSection({ title, description, signals, empty }: { title: string; description: string; signals: PortfolioSignal[]; empty: string }) {
  return (
    <Card>
      <div><h2 className="font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm leading-5 text-muted">{description}</p></div>
      <div className="mt-5 space-y-3">
        {signals.length > 0 ? signals.map((signal) => <SignalCard key={signal.id} signal={signal} />) : <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{empty}</p>}
      </div>
    </Card>
  );
}

function SignalCard({ signal }: { signal: PortfolioSignal }) {
  return (
    <article className={cn("rounded-xl border border-border bg-surface p-4", signal.state === "NEEDS_REVIEW" && "border-warning/35", signal.lifecycle === "RESOLVED" && "border-success/25")}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><span>{humanize(signal.category)}</span><span aria-hidden="true">·</span><span>{humanize(signal.lifecycle)}</span></div>
          <h3 className="mt-2 font-semibold leading-6 text-foreground">{signal.title}</h3>
          {signal.value ? <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{formatSignalValue(signal.value.previous, signal.value.unit)} <span className="px-1 text-muted">→</span> {formatSignalValue(signal.value.current, signal.value.unit)}</p> : null}
        </div>
        <ReviewStateBadge state={signal.state} compact />
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <SignalFact label="Cause" value={signal.primaryCause.description} />
        <SignalFact label="Policy" value={signal.affectedRule?.description ?? "No configured portfolio rule"} />
        <SignalFact label="Posture" value={signal.reviewPosture} />
        <SignalFact label="Data" value={humanize(signal.dataQuality.state)} />
      </dl>
      {signal.evidence.length > 0 ? <div className="mt-4 flex flex-wrap gap-2">{signal.evidence.map((item) => <span key={`${item.label}:${item.value}`} className="rounded-md bg-surface-strong px-2.5 py-1.5 text-xs text-muted"><span className="font-medium text-foreground">{item.label}:</span> {item.value}</span>)}</div> : null}
    </article>
  );
}

function SignalFact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 leading-5 text-foreground">{value}</dd></div>;
}

function ReviewStateBadge({ state, compact = false }: { state: PortfolioReviewState; compact?: boolean }) {
  const Icon = state === "NEEDS_REVIEW" ? CircleAlert : state === "WATCH" ? Eye : CheckCircle2;
  return <span className={cn("inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold", state === "NEEDS_REVIEW" && "border-warning/35 bg-warning/10 text-warning", state === "WATCH" && "border-primary/30 bg-primary/10 text-primary", state === "CLEAR" && "border-success/30 bg-success/10 text-success", compact && "px-2.5 py-1")}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{state === "NEEDS_REVIEW" ? "NEEDS REVIEW" : state}</span>;
}

function DataStateBadge({ state }: { state: PortfolioSignalDataQualityState }) {
  return <span className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", state === "COMPLETE" && "border-success/30 bg-success/10 text-success", state === "STALE" && "border-warning/30 bg-warning/10 text-warning", (state === "PARTIAL" || state === "UNAVAILABLE") && "border-destructive/30 bg-destructive/10 text-destructive")}>{state}</span>;
}

function formatSignalValue(value: string | null, unit: "PERCENTAGE_POINTS" | "COUNT") {
  if (value === null) return "Unavailable";
  return unit === "PERCENTAGE_POINTS" ? formatDecimalPercent(value) : value;
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
