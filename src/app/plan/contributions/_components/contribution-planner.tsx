"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { AssetClass } from "@/lib/domain/enums";
import { AlertCircle, CheckCircle2, RotateCcw, Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { previewContributionAction, saveContributionPlanAction } from "@/features/contributions/actions";
import type { ContributionPlannerModel } from "@/features/contributions/read-model";
import type { ContributionProjection } from "@/features/portfolio-engine";
import { moneyToCents, type ParsedContributionAllocation } from "@/features/contributions/validation";
import { contributionClassLabels as classLabels, contributionReasonText } from "@/features/contributions/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";
import { formatUtcTimestamp } from "@/lib/format/date";

type PreviewState = Pick<ContributionPlannerModel, "recommendedAllocations" | "valuation"> & { projection: ContributionProjection | null };

export function ContributionPlanner({ model }: { model: ContributionPlannerModel }) {
  const [amount, setAmount] = useState(model.contributionAmount);
  const [allocations, setAllocations] = useState(model.allocations);
  const [isCustomized, setIsCustomized] = useState(model.isCustomized);
  const [preview, setPreview] = useState<PreviewState>({ projection: model.projection, recommendedAllocations: model.recommendedAllocations, valuation: model.valuation });
  const [previewError, setPreviewError] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState(model.savedAt);
  const [isPreviewQueued, setIsPreviewQueued] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();
  const requestId = useRef(0);
  const allocationAnalysis = useMemo(() => analyzeDraft(amount, allocations), [amount, allocations]);
  const requestAllocations = useMemo(() => isCustomized ? allocations : undefined, [isCustomized, allocations]);
  const activeAssetClasses = model.strategy.allocations.map((allocation) => allocation.assetClass);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!amount.trim() || (isCustomized && !allocationAnalysis.isValid)) return;

    const timer = window.setTimeout(() => {
      startPreviewTransition(async () => {
        const result = await previewContributionAction({ contributionAmount: amount, allocations: requestAllocations });
        if (currentRequest !== requestId.current) return;
        if (!result.ok) {
          setPreviewError(result.message);
          setIsPreviewQueued(false);
          return;
        }
        setPreviewError("");
        setPreview(result.data);
        setIsPreviewQueued(false);
        if (!isCustomized) setAllocations(result.data.recommendedAllocations);
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [amount, isCustomized, requestAllocations, allocationAnalysis.isValid]);

  function changeAmount(value: string) {
    setSaveMessage(null);
    setPreviewError("");
    setIsPreviewQueued(Boolean(value));
    setAmount(value);
    setIsCustomized(false);
  }

  function changeAllocation(assetClass: AssetClass, value: string) {
    setSaveMessage(null);
    setPreviewError("");
    setIsPreviewQueued(true);
    setIsCustomized(true);
    setAllocations((current) => current.map((allocation) => allocation.assetClass === assetClass ? { ...allocation, amount: value } : allocation));
  }

  function resetToRecommendation() {
    setSaveMessage(null);
    setPreviewError("");
    setIsPreviewQueued(true);
    setIsCustomized(false);
    setAllocations(preview.recommendedAllocations);
  }

  function savePlan() {
    if (!preview.projection || !allocationAnalysis.isValid) return;
    startSaveTransition(async () => {
      const result = await saveContributionPlanAction({
        strategyId: model.strategy.id,
        currency: model.strategy.currency,
        contributionAmount: amount,
        allocations,
        isCustomized,
      });
      setSaveMessage({ ok: result.ok, text: result.message });
      if (result.ok) setSavedAt(result.savedAt);
    });
  }

  const projection = preview.projection;
  const hasPositiveAmount = allocationAnalysis.expectedCents > 0;
  const displayedPreviewError = isCustomized && !allocationAnalysis.isValid ? allocationAnalysis.message : previewError;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <label className="block max-w-md flex-1">
            <span className="mb-2 block text-sm font-medium text-foreground">How much do you want to invest?</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-muted">{model.strategy.currency === "USD" ? "$" : model.strategy.currency}</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="1,000.00" className="h-14 w-full rounded-lg border border-border bg-surface pl-9 pr-20 text-xl font-semibold text-foreground outline-none transition placeholder:text-muted/50 focus:border-primary" />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">{model.strategy.currency}</span>
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {savedAt ? <Badge>Saved {formatUtcTimestamp(savedAt)}</Badge> : <Badge>Not saved</Badge>}
            {isCustomized ? <Badge tone="primary">Custom allocation</Badge> : <Badge tone="success">Recommended</Badge>}
          </div>
        </div>
        {preview.valuation.isPartial ? <Notice tone="warning">Planning uses the valued portion of your portfolio. Price unavailable for: {preview.valuation.missingPriceSymbols.join(", ")}.</Notice> : null}
        {preview.valuation.hasStalePrices ? <Notice tone="warning">Some market prices are stale.</Notice> : null}
        {preview.valuation.warning ? <Notice tone="warning">{preview.valuation.warning}</Notice> : null}
        {model.setupError ? <Notice tone="destructive">{model.setupError}</Notice> : null}
        {preview.valuation.lastUpdated ? <p className="mt-3 text-xs text-muted">Prices last updated {formatUtcTimestamp(preview.valuation.lastUpdated)}</p> : null}
      </Card>

      {!hasPositiveAmount ? (
        <Card className="py-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">Enter a contribution amount</h2>
          <p className="mt-2 text-sm text-muted">Your strategy-aware recommendation will appear here.</p>
          {amount && !allocationAnalysis.amountValid ? <p className="mt-3 text-sm text-destructive">{allocationAnalysis.message}</p> : null}
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><h2 className="text-lg font-semibold">{isCustomized ? "Custom buy list" : "Recommended buy list"}</h2><p className="mt-1 text-sm text-muted">Calculated by the deterministic Portfolio Engine.</p></div>
              {!isCustomized ? (
                <Button type="button" variant="secondary" onClick={() => setIsCustomized(true)} disabled={!projection}><SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" /> Customize allocation</Button>
              ) : (
                <Button type="button" variant="secondary" onClick={resetToRecommendation}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Reset to recommendation</Button>
              )}
            </div>

            {projection ? <BuyList projection={projection} currency={model.strategy.currency} /> : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {activeAssetClasses.map((assetClass) => {
                const allocation = allocations.find((item) => item.assetClass === assetClass);
                const displayed = projection?.plan.allocations.find((item) => item.assetClass === assetClass);
                return (
                  <div key={assetClass} className="rounded-lg border border-border bg-surface p-4">
                    <div className="flex items-center justify-between gap-2"><p className="font-semibold">{classLabels[assetClass]}</p><Badge>{displayed?.percentOfContribution ?? "0.00"}%</Badge></div>
                    {isCustomized ? (
                      <div className="relative mt-4"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{model.strategy.currency === "USD" ? "$" : model.strategy.currency}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={allocation?.amount ?? "0.00"} onChange={(event) => changeAllocation(assetClass, event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface-strong pl-8 pr-3 text-right font-medium outline-none focus:border-primary" /></div>
                    ) : <p className="mt-4 text-2xl font-semibold">{formatMoney(displayed?.amount ?? allocation?.amount ?? "0", model.strategy.currency)}</p>}
                  </div>
                );
              })}
            </div>

            {isCustomized ? <div className={cn("mt-4 flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between", allocationAnalysis.isValid ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10 text-warning")}><span>{allocationAnalysis.message}</span><span className="font-semibold">{formatMoney(String(allocationAnalysis.totalCents / 100), model.strategy.currency)} / {formatMoney(amount || "0", model.strategy.currency)}</span></div> : null}
            {isPreviewPending ? <p className="mt-3 text-sm text-muted">Updating projected allocation…</p> : null}
            {displayedPreviewError ? <Notice tone="destructive">{displayedPreviewError}</Notice> : null}
          </Card>
          {projection ? <ImpactTable projection={projection} /> : null}
          {projection ? <Reasons projection={projection} /> : null}
        </>
      )}

      {saveMessage ? <Notice tone={saveMessage.ok ? "success" : "destructive"}>{saveMessage.text}</Notice> : null}
      <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg shadow-background/40 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
        <p className="text-sm text-muted">Saving a plan never creates transactions.</p>
        <Button type="button" onClick={savePlan} disabled={!projection || !allocationAnalysis.isValid || isPreviewQueued || isPreviewPending || isSavePending || Boolean(displayedPreviewError)}><Save className="mr-2 h-4 w-4" aria-hidden="true" />{isSavePending ? "Saving…" : "Save plan"}</Button>
      </div>
    </div>
  );
}

function ImpactTable({ projection }: { projection: ContributionProjection }) {
  return <Card><h2 className="text-lg font-semibold">Portfolio impact</h2><div className="mt-4 space-y-3 md:hidden">{projection.afterComparison.map((after) => { const before = projection.beforeComparison.find((item) => item.assetClass === after.assetClass); return <div key={after.assetClass} className="rounded-lg border border-border bg-surface p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{classLabels[after.assetClass]}</p><StatusBadge status={after.status} /></div><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><ImpactValue label="Current" value={formatPercent(before?.currentPercent ?? "0")} /><ImpactValue label="After" value={formatPercent(after.currentPercent)} emphasized /><ImpactValue label="Target" value={formatPercent(after.targetPercent)} /><ImpactValue label="Range" value={`${formatPercent(after.minPercent)}–${formatPercent(after.maxPercent)}`} /></dl></div>; })}</div><div className="mt-5 hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-border text-xs uppercase tracking-wide text-muted"><tr>{["Asset class", "Current", "After contribution", "Target", "Range", "Status after"].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{projection.afterComparison.map((after) => { const before = projection.beforeComparison.find((item) => item.assetClass === after.assetClass); return <tr key={after.assetClass}><td className="px-3 py-4 font-medium">{classLabels[after.assetClass]}</td><td className="px-3 py-4">{formatPercent(before?.currentPercent ?? "0")}</td><td className="px-3 py-4 font-semibold">{formatPercent(after.currentPercent)}</td><td className="px-3 py-4">{formatPercent(after.targetPercent)}</td><td className="px-3 py-4 text-muted">{formatPercent(after.minPercent)}–{formatPercent(after.maxPercent)}</td><td className="px-3 py-4"><StatusBadge status={after.status} /></td></tr>; })}</tbody></table></div></Card>;
}

function BuyList({ projection, currency }: { projection: ContributionProjection; currency: string }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface">
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.8fr)_minmax(6rem,0.6fr)_minmax(6rem,0.6fr)] gap-3 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted md:grid">
        <span>Asset</span>
        <span>Class</span>
        <span className="text-right">Buy</span>
        <span className="text-right">Contribution</span>
      </div>
      <div className="divide-y divide-border">
        {projection.plan.assetRecommendations.map((item) => (
          <div key={item.assetId} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.8fr)_minmax(6rem,0.6fr)_minmax(6rem,0.6fr)] md:items-center">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{item.symbol}</p>
              <p className="mt-1 truncate text-sm text-muted">{item.name}</p>
            </div>
            <Badge>{classLabels[item.assetClass]}</Badge>
            <p className="text-right text-lg font-semibold">{formatMoney(item.amount, currency)}</p>
            <p className="text-right text-sm text-muted">{formatPercent(item.percentOfContribution)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImpactValue({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div><dt className="text-xs uppercase tracking-wide text-muted">{label}</dt><dd className={cn("mt-1", emphasized && "font-semibold text-foreground")}>{value}</dd></div>;
}

function Reasons({ projection }: { projection: ContributionProjection }) {
  const messages = [...new Set(projection.reasons.map(contributionReasonText))];
  return <Card><h2 className="text-lg font-semibold">Why this allocation</h2><div className="mt-4 space-y-3">{messages.map((message) => <div key={message} className="flex items-start gap-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><p className="text-muted">{message}</p></div>)}</div>{projection.warnings.map((warning) => <Notice key={warning.code} tone="warning">{classLabels[warning.assetClass]} after contribution is {formatPercent(warning.currentPercent)}; configured {warning.code.endsWith("ABOVE_MAX") ? "maximum" : "minimum"} is {formatPercent(warning.limitPercent)}. This is advisory and does not block saving.</Notice>)}</Card>;
}

function StatusBadge({ status }: { status: "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT" }) {
  return <Badge tone={status === "IN_RANGE" ? "success" : status === "OVERWEIGHT" ? "warning" : "primary"}>{status === "IN_RANGE" ? "In range" : status === "OVERWEIGHT" ? "Overweight" : "Underweight"}</Badge>;
}

function Notice({ children, tone }: { children: ReactNode; tone: "warning" | "destructive" | "success" }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return <div className={cn("mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm", tone === "warning" && "border-warning/30 bg-warning/10 text-warning", tone === "destructive" && "border-destructive/30 bg-destructive/10 text-destructive", tone === "success" && "border-success/30 bg-success/10 text-success")}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{children}</span></div>;
}

function analyzeDraft(amount: string, allocations: ParsedContributionAllocation[]) {
  try {
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Enter a valid contribution amount with at most two decimal places.");
    const totalCents = allocations.reduce((sum, allocation) => sum + moneyToCents(allocation.amount), 0);
    const expectedCents = moneyToCents(amount);
    const isValid = totalCents === expectedCents;
    return { isValid, amountValid: true, totalCents, expectedCents, message: isValid ? "Custom allocation matches the contribution amount." : "Custom amounts must equal the contribution amount." };
  } catch (error) {
    return { isValid: false, amountValid: false, totalCents: 0, expectedCents: 0, message: error instanceof Error ? error.message : "Custom allocation is invalid." };
  }
}

function formatMoney(value: string, currency: string) { return formatDecimalCurrency(value, currency); }
function formatPercent(value: string) { return formatDecimalPercent(value); }
