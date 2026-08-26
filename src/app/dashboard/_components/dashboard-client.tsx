"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AlertCircle, ArrowRight, Building2, CheckCircle2, CircleDollarSign, Info, Sparkles, Target, X } from "lucide-react";
import { previewContributionAction } from "@/features/contributions/actions";
import { contributionClassLabels, contributionReasonText } from "@/features/contributions/presentation";
import type { DashboardReadModel } from "@/features/dashboard/read-model";
import { formatDashboardCurrency as formatCurrency, formatDashboardPercent as formatPercent, formatDashboardSignedCurrency as formatSignedCurrency, strategyWarningText } from "@/features/dashboard/presentation";
import type { ContributionProjection } from "@/features/portfolio-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { decimalSign } from "@/lib/format/decimal";
import { formatUtcDate } from "@/lib/format/date";

const chartColors = ["#8b5cf6", "#a78bfa", "#c4b5fd", "#64748b"];

export function DashboardClient({ dashboard }: { dashboard: DashboardReadModel }) {
  const [amount, setAmount] = useState(dashboard.contribution.amount);
  const [projection, setProjection] = useState(dashboard.contribution.projection);
  const [previewError, setPreviewError] = useState("");
  const [isAlignmentOpen, setIsAlignmentOpen] = useState(false);
  const [isReasonsOpen, setIsReasonsOpen] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  useEffect(() => {
    if (!isValidPositiveAmount(amount)) return;
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      startPreviewTransition(async () => {
        const result = await previewContributionAction({ contributionAmount: amount });
        if (!isCurrent) return;
        if (!result.ok) {
          setPreviewError(result.message);
          return;
        }
        setPreviewError("");
        setProjection(result.data.projection);
      });
    }, 350);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [amount]);

  function changeAmount(value: string) {
    setAmount(value);
    setProjection(null);
    setPreviewError(value && !isValidPositiveAmount(value) ? `Enter a positive ${dashboard.valuation.currency} amount with at most two decimal places.` : "");
  }

  return (
    <div className="space-y-4">
      {dashboard.valuation.warning ? <Notice tone="warning">{dashboard.valuation.warning}</Notice> : null}
      {dashboard.valuation.isPartial ? (
        <Notice tone="warning">Valuation and allocation use available prices only. Missing: {dashboard.valuation.missingPriceSymbols.join(", ")}.</Notice>
      ) : null}

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TotalValueCard dashboard={dashboard} />
        <div className="order-4 md:order-2"><AlignmentCard dashboard={dashboard} onDetails={() => setIsAlignmentOpen(true)} /></div>
        <div className="order-2 md:order-3"><AllocationCard dashboard={dashboard} /></div>
        <div className="order-3 md:order-4"><ContributionCard currency={dashboard.valuation.currency} amount={amount} projection={projection} error={previewError} isPending={isPreviewPending} onAmount={changeAmount} onReasons={() => setIsReasonsOpen(true)} /></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <RecentActivity dashboard={dashboard} />
        <Accounts dashboard={dashboard} />
      </div>

      <StrategyStatus dashboard={dashboard} />

      {isAlignmentOpen ? <AlignmentDetails dashboard={dashboard} onClose={() => setIsAlignmentOpen(false)} /> : null}
      {isReasonsOpen && projection ? <ReasonDetails projection={projection} onClose={() => setIsReasonsOpen(false)} /> : null}
    </div>
  );
}

function TotalValueCard({ dashboard }: { dashboard: DashboardReadModel }) {
  const gain = dashboard.valuation.investmentGain;
  return (
    <Card className="order-1 min-w-0 md:order-1">
      <CardHeading title="Total portfolio value" icon={<CircleDollarSign className="h-5 w-5" />} />
      <p className="mt-6 break-words text-3xl font-semibold tracking-tight xl:text-[1.75rem]">{formatCurrency(dashboard.valuation.totalValue, dashboard.valuation.currency)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dashboard.alignment.totalHoldings === 0 ? <Badge>No holdings</Badge> : dashboard.valuation.isPartial ? <Badge tone="warning">Partial value</Badge> : <Badge tone="success">All prices available</Badge>}
        {dashboard.valuation.hasStalePrices ? <Badge tone="warning">Stale prices</Badge> : null}
        {dashboard.valuation.isCostBasisPartial ? <Badge tone="warning">Partial cost basis</Badge> : null}
      </div>
      {gain !== null ? (
        <div className="mt-5 grid gap-3 border-t border-border pt-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Investment gain</p>
            <p className={cn("mt-1 font-semibold", (decimalSign(gain) ?? 0) >= 0 ? "text-success" : "text-destructive")}>{formatSignedCurrency(gain, dashboard.valuation.currency)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric label="Net invested" value={dashboard.valuation.netInvested ? formatCurrency(dashboard.valuation.netInvested, dashboard.valuation.currency) : "Unavailable"} />
            <Metric label="Simple return" value={dashboard.valuation.simpleReturnPercent ? formatPercent(dashboard.valuation.simpleReturnPercent) : "Unavailable"} />
          </div>
          <Link href="/performance" className="text-sm font-medium text-primary hover:underline">View performance</Link>
        </div>
      ) : <p className="mt-5 border-t border-border pt-4 text-sm text-muted">Performance is unavailable until current price coverage is complete.</p>}
      {dashboard.valuation.isCostBasisPartial ? <p className="mt-3 text-xs text-warning">Excludes {dashboard.valuation.missingCostBasisSymbols.join(", ")} from gain and return.</p> : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-semibold text-foreground">{value}</p></div>;
}

function AlignmentCard({ dashboard, onDetails }: { dashboard: DashboardReadModel; onDetails: () => void }) {
  const { alignment } = dashboard;
  return (
    <Card className="h-full min-w-0">
      <CardHeading title="Strategy alignment" icon={<Target className="h-5 w-5" />} />
      <p className="mt-6 text-3xl font-semibold">{alignment.score === null ? "—" : `${alignment.score}/100`}</p>
      <p className="mt-2 text-sm text-muted">{alignment.score === null ? "Add holdings to calculate alignment." : `${alignment.inRangeClasses}/${alignment.totalClasses} asset classes in range`}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-strong"><div className="h-full rounded-full bg-primary" style={{ width: `${alignment.score ?? 0}%` }} /></div>
      <Button type="button" variant="ghost" className="mt-4 px-0" onClick={onDetails}><Info className="mr-2 h-4 w-4" />View details</Button>
    </Card>
  );
}

function AllocationCard({ dashboard }: { dashboard: DashboardReadModel }) {
  const hasValue = dashboard.allocation.some((item) => decimalSign(item.value) === 1);
  return (
    <Card className="h-full min-w-0">
      <CardHeading title="Allocation" icon={<Target className="h-5 w-5" />} />
      {hasValue ? (
        <div className="mt-3 h-36"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dashboard.allocation} dataKey={(entry) => Number(entry.value)} nameKey="assetClass" innerRadius={38} outerRadius={58} paddingAngle={2} stroke="none">{dashboard.allocation.map((item, index) => <Cell key={item.assetClass} fill={chartColors[index]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(String(value ?? 0), dashboard.valuation.currency)} contentStyle={{ background: "#171a26", border: "1px solid #282d3d", borderRadius: 8 }} /></PieChart></ResponsiveContainer></div>
      ) : <div className="mx-auto mt-5 flex h-28 w-28 items-center justify-center rounded-full border-[14px] border-surface-strong text-center text-xs text-muted">No valued<br />holdings</div>}
      <div className="mt-3 space-y-2">
        {dashboard.allocation.map((item, index) => <div key={item.assetClass} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs"><span className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: chartColors[index] }} />{contributionClassLabels[item.assetClass]}</span><span className="text-muted">{formatPercent(item.currentPercent)} / {formatPercent(item.targetPercent)}</span><StatusDot status={item.status} /></div>)}
      </div>
    </Card>
  );
}

function ContributionCard({ currency, amount, projection, error, isPending, onAmount, onReasons }: { currency: string; amount: string; projection: ContributionProjection | null; error: string; isPending: boolean; onAmount: (value: string) => void; onReasons: () => void }) {
  const href = isValidPositiveAmount(amount) ? `/plan/contributions?amount=${encodeURIComponent(amount)}` : "/plan/contributions";
  return (
    <Card className="h-full min-w-0">
      <CardHeading title="Suggested next move" icon={<Sparkles className="h-5 w-5" />} />
      <label className="mt-5 block"><span className="mb-2 block text-xs uppercase tracking-wide text-muted">Next contribution</span><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">{currency === "USD" ? "$" : currency}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} placeholder="1,000" className="h-11 w-full rounded-lg border border-border bg-surface pl-8 pr-12 outline-none focus:border-primary" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{currency}</span></div></label>
      {isPending ? <p className="mt-3 text-xs text-muted">Updating recommendation…</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      {projection ? <div className="mt-4 grid grid-cols-2 gap-2">{projection.plan.assetRecommendations.map((item) => <div key={item.assetId} className="rounded-lg bg-surface p-2"><p className="truncate text-xs text-muted">{item.symbol}</p><p className="mt-1 text-sm font-semibold">{formatCurrency(item.amount, currency)}</p><p className="mt-1 text-[11px] text-muted">{item.percentOfContribution}%</p></div>)}</div> : <p className="mt-4 text-sm text-muted">Enter an amount to calculate the next contribution.</p>}
      <div className="mt-4 flex flex-col gap-2"><Link href={href} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90">Plan contribution <ArrowRight className="ml-2 h-4 w-4" /></Link><Button type="button" variant="ghost" onClick={onReasons} disabled={!projection}>Why this recommendation?</Button></div>
    </Card>
  );
}

function RecentActivity({ dashboard }: { dashboard: DashboardReadModel }) {
  return <Card><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Recent activity</h2><p className="mt-1 text-sm text-muted">Latest five portfolio transactions.</p></div><Link href="/portfolio" className="text-sm text-primary hover:underline">View all</Link></div>{dashboard.recentActivity.length ? <div className="mt-5 divide-y divide-border">{dashboard.recentActivity.map((item) => <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><Badge tone={item.type === "SELL" ? "destructive" : "neutral"}>{formatType(item.type)}</Badge><p className="truncate font-medium">{item.assetName} · {item.symbol}</p></div><p className="mt-1 text-xs text-muted">{item.accountName} · {formatUtcDate(item.executedAt)}</p></div><div className="text-left sm:text-right"><p className="font-medium">{item.quantityLabel}{item.displayPriceUnit === "unit" ? ` ${item.symbol}` : ""}</p><p className="mt-1 text-xs text-muted">{item.pricePerUnit ? `${formatCurrency(item.pricePerUnit, item.currency)} / ${item.displayPriceUnit}` : "No acquisition price"}</p></div></div>)}</div> : <InlineEmpty title="No activity yet" description="Transactions will appear here after you add an initial balance or trade." />}</Card>;
}

function Accounts({ dashboard }: { dashboard: DashboardReadModel }) {
  return <Card><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Accounts</h2><p className="mt-1 text-sm text-muted">Value by account.</p></div><Building2 className="h-5 w-5 text-primary" /></div>{dashboard.accounts.length ? <div className="mt-5 space-y-3">{dashboard.accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"><div className="min-w-0"><p className="truncate font-medium">{account.name}</p><p className="mt-1 text-xs text-muted">{formatType(account.type)}</p></div><div className="text-right"><p className="font-semibold">{formatCurrency(account.value, dashboard.valuation.currency)}</p>{account.isPartial ? <Badge tone="warning" className="mt-1">Partial</Badge> : null}</div></div>)}</div> : <InlineEmpty title="No accounts" description="Add an account from the Portfolio page." />}</Card>;
}

function StrategyStatus({ dashboard }: { dashboard: DashboardReadModel }) {
  const status = dashboard.strategyStatus;
  const first = status.warnings[0];
  const isAttention = status.state === "NEEDS_ATTENTION";
  const title = status.state === "EMPTY" ? "Start building your portfolio" : isAttention ? "Portfolio needs attention" : "Stay consistent";
  const description = status.state === "EMPTY" ? "Add an initial balance to compare your portfolio with the active strategy." : first ? strategyWarningText(first) : "Your priced portfolio is currently inside all configured allocation ranges.";
  return <Card className={cn("border-primary/25 bg-gradient-to-br from-card to-primary/5", isAttention && "border-warning/30 from-card to-warning/5")}><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3">{status.state === "EMPTY" ? <Sparkles className="mt-1 h-5 w-5 shrink-0 text-primary" /> : isAttention ? <AlertCircle className="mt-1 h-5 w-5 shrink-0 text-warning" /> : <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-success" />}<div className="min-w-0"><p className="break-words text-xs uppercase tracking-wide text-muted">Strategy status{status.strategyName ? ` · ${status.strategyName}` : ""}</p><h2 className="mt-2 text-xl font-semibold">{title}</h2><p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>{dashboard.valuation.isPartial ? <p className="mt-2 text-sm text-warning">Status is based on priced holdings only.</p> : null}</div></div><Link href="/assistant" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-strong px-4 text-sm font-medium hover:border-primary/50">Ask Assistant</Link></div></Card>;
}

function AlignmentDetails({ dashboard, onClose }: { dashboard: DashboardReadModel; onClose: () => void }) {
  const alignment = dashboard.alignment;
  return <Modal title="How Strategy Alignment is calculated" onClose={onClose}><p className="text-sm leading-6 text-muted">This is a deterministic transparency score, not an AI opinion.</p><div className="mt-5 space-y-3"><ScoreRow label="Allocation compliance" value={`${alignment.allocationPoints}/80`} detail={`${alignment.inRangeClasses}/${alignment.totalClasses} classes inside configured ranges · 20 points each`} /><ScoreRow label="Price data availability" value={`${alignment.priceDataPoints}/20`} detail={`${alignment.pricedHoldings}/${alignment.totalHoldings} holdings have current prices`} /><ScoreRow label="Total" value={alignment.score === null ? "Unavailable" : `${alignment.score}/100`} detail={alignment.score === null ? "A non-empty portfolio is required." : "No hidden weighting or AI-generated adjustment."} /></div>{dashboard.valuation.isPartial ? <Notice tone="warning">Allocation compliance is based on the priced portion of the portfolio.</Notice> : null}</Modal>;
}

function ReasonDetails({ projection, onClose }: { projection: ContributionProjection; onClose: () => void }) {
  const messages = [...new Set(projection.reasons.map(contributionReasonText))];
  return <Modal title="Why this recommendation?" onClose={onClose}><div className="space-y-3">{messages.map((message) => <div key={message} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-sm text-muted">{message}</p></div>)}</div></Modal>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-end bg-background/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm md:items-center md:justify-center md:p-4" role="dialog" aria-modal="true" aria-label={title}><Card className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full overflow-y-auto overscroll-contain rounded-xl md:max-h-[90vh] md:max-w-lg"><div className="flex items-start justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button></div><div className="mt-5">{children}</div></Card></div>; }
function ScoreRow({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-3"><div><p className="font-medium">{label}</p><p className="mt-1 text-xs leading-5 text-muted">{detail}</p></div><p className="shrink-0 font-semibold text-primary">{value}</p></div>; }
function CardHeading({ title, icon }: { title: string; icon: ReactNode }) { return <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-muted">{title}</p><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary">{icon}</span></div>; }
function StatusDot({ status }: { status: "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT" }) { return <span className={cn("h-2 w-2 rounded-full", status === "IN_RANGE" ? "bg-success" : status === "OVERWEIGHT" ? "bg-destructive" : "bg-warning")} title={formatType(status)} />; }
function Notice({ children }: { children: ReactNode; tone?: "warning" }) { return <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{children}</div>; }
function InlineEmpty({ title, description }: { title: string; description: string }) { return <div className="mt-5 rounded-lg border border-dashed border-border bg-surface/50 px-4 py-10 text-center"><p className="font-medium">{title}</p><p className="mt-2 text-sm text-muted">{description}</p></div>; }
function isValidPositiveAmount(value: string) { return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0; }
function formatType(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
