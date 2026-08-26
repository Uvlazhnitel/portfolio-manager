"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { AssetClass, type AssetClass as AssetClassValue } from "@/lib/domain/enums";
import { AlertCircle, CheckCircle2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { updateStrategyAction } from "@/features/strategy/actions";
import type { StrategyEditorModel } from "@/features/strategy/read-model";
import {
  analyzeStrategyDraft,
  assetClassOrder,
  editableAssetClasses,
  strategyDraftFingerprint,
  type StrategyAllocationInput,
} from "@/features/strategy/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatUtcTimestamp } from "@/lib/format/date";

type Draft = Pick<StrategyEditorModel, "id" | "name" | "rules"> & {
  allocations: StrategyAllocationInput[];
};
type AllocationField = "targetPercent" | "minPercent" | "maxPercent";

const allocationLabels: Record<AllocationField, string> = {
  targetPercent: "Target %",
  minPercent: "Minimum %",
  maxPercent: "Maximum %",
};

export function StrategyEditor({ strategy }: { strategy: StrategyEditorModel }) {
  const initialDraft = useMemo(() => createDraft(strategy), [strategy]);
  const [draft, setDraft] = useState(initialDraft);
  const [actionState, formAction, isPending] = useActionState(updateStrategyAction, {
    ok: false,
    message: "",
  });
  const analysis = analyzeStrategyDraft({
    name: draft.name,
    allocations: draft.allocations,
    minimumRebalanceDrift: draft.rules.minimumRebalanceDrift,
  });
  const isDirty = strategyDraftFingerprint(draft) !== strategyDraftFingerprint(initialDraft);
  const cryptoAllocation = draft.allocations.find((allocation) => allocation.assetClass === AssetClass.CRYPTO);
  const availableAssetClasses = editableAssetClasses.filter(
    (assetClass) => !draft.allocations.some((allocation) => allocation.assetClass === assetClass),
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  function updateAllocation(assetClass: AssetClassValue, field: AllocationField, value: string) {
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) =>
        allocation.assetClass === assetClass ? { ...allocation, [field]: value } : allocation,
      ),
    }));
  }

  function addAllocation(assetClass: AssetClassValue) {
    const firstAsset = strategy.availableAssets.find((asset) => asset.assetClass === assetClass);
    setDraft((current) => ({
      ...current,
      allocations: [
        ...current.allocations,
        {
          assetClass,
          targetPercent: "0",
          minPercent: "0",
          maxPercent: "100",
          assetTargets: firstAsset ? [{ assetId: firstAsset.id, targetPercent: "100" }] : [],
        },
      ].sort((left, right) => assetClassOrder(left.assetClass) - assetClassOrder(right.assetClass)),
    }));
  }

  function removeAllocation(assetClass: AssetClassValue) {
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.filter((allocation) => allocation.assetClass !== assetClass),
    }));
  }

  function updateRule<Key extends keyof Draft["rules"]>(key: Key, value: Draft["rules"][Key]) {
    setDraft((current) => ({ ...current, rules: { ...current.rules, [key]: value } }));
  }

  function addAssetTarget(assetClass: AssetClassValue, assetId: string) {
    if (!assetId) return;
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) => {
        if (allocation.assetClass !== assetClass || allocation.assetTargets.some((target) => target.assetId === assetId)) {
          return allocation;
        }
        return {
          ...allocation,
          assetTargets: [
            ...allocation.assetTargets,
            { assetId, targetPercent: allocation.assetTargets.length === 0 ? "100" : "0" },
          ],
        };
      }),
    }));
  }

  function updateAssetTarget(assetClass: AssetClassValue, assetId: string, value: string) {
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) =>
        allocation.assetClass === assetClass
          ? {
              ...allocation,
              assetTargets: allocation.assetTargets.map((target) =>
                target.assetId === assetId ? { ...target, targetPercent: value } : target,
              ),
            }
          : allocation,
      ),
    }));
  }

  function removeAssetTarget(assetClass: AssetClassValue, assetId: string) {
    setDraft((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) =>
        allocation.assetClass === assetClass
          ? { ...allocation, assetTargets: allocation.assetTargets.filter((target) => target.assetId !== assetId) }
          : allocation,
      ),
    }));
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(draft)} />

      <Card>
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <label className="block flex-1">
            <span className="mb-2 block text-sm font-medium text-muted">Strategy name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className={inputClassName}
              maxLength={120}
            />
            <span className="mt-2 block text-sm leading-6 text-muted">{strategy.objective}</span>
          </label>
          <div className="rounded-lg border border-border bg-surface px-4 py-3 md:min-w-44">
            <p className="text-xs uppercase tracking-wide text-muted">Base currency</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{strategy.baseCurrency}</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Target allocation</h2>
            <p className="mt-1 text-sm text-muted">Targets must total exactly 100%. Minimum and maximum totals are independent.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={analysis.totalBasisPoints === 10_000 ? "success" : "warning"}>
              Total: {analysis.totalPercent}%
            </Badge>
            {isDirty ? <Badge tone="primary">Unsaved changes</Badge> : <Badge>Saved</Badge>}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {draft.allocations.map((allocation) => (
            <AllocationRow
              key={allocation.assetClass}
              allocation={allocation}
              availableAssets={strategy.availableAssets.filter((asset) => asset.assetClass === allocation.assetClass)}
              onChange={(field, value) => updateAllocation(allocation.assetClass, field, value)}
              onRemove={() => removeAllocation(allocation.assetClass)}
              onAddAsset={(assetId) => addAssetTarget(allocation.assetClass, assetId)}
              onChangeAsset={(assetId, value) => updateAssetTarget(allocation.assetClass, assetId, value)}
              onRemoveAsset={(assetId) => removeAssetTarget(allocation.assetClass, assetId)}
            />
          ))}
        </div>

        {availableAssetClasses.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {availableAssetClasses.map((assetClass) => (
              <Button key={assetClass} type="button" variant="secondary" onClick={() => addAllocation(assetClass)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                {formatAssetClass(assetClass)}
              </Button>
            ))}
          </div>
        ) : null}

        {!analysis.isValid ? (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Strategy cannot be saved yet.</p>
              <p className="mt-1">{analysis.errors[0]}</p>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Portfolio rules</h2>
          <p className="mt-1 text-sm text-muted">Deterministic preferences used by future planning and decision support.</p>
        </div>

        <div className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface px-4">
          <RuleToggle
            label="Prefer new contributions over selling"
            description="Move toward target allocation with future investments first."
            checked={draft.rules.preferContributionsOverSelling}
            onChange={(checked) => updateRule("preferContributionsOverSelling", checked)}
          />
          <RuleToggle
            label="Challenge decisions that violate strategy"
            description="Flag actions that move the portfolio outside configured ranges."
            checked={draft.rules.challengeStrategyViolations}
            onChange={(checked) => updateRule("challengeStrategyViolations", checked)}
          />
          <RuleToggle
            label="Prefer no action when evidence is weak"
            description="Avoid forcing a recommendation when deterministic evidence is insufficient."
            checked={draft.rules.preferNoActionWhenEvidenceWeak}
            onChange={(checked) => updateRule("preferNoActionWhenEvidenceWeak", checked)}
          />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <NumberRule
            label="Minimum drift before rebalance warning"
            description="Percentage points away from target before a warning is meaningful."
            value={draft.rules.minimumRebalanceDrift}
            onChange={(value) => updateRule("minimumRebalanceDrift", value)}
          />
          {cryptoAllocation ? (
            <NumberRule
              label="Maximum crypto allocation"
              description="Same source of truth as Crypto Maximum in target allocation."
              value={cryptoAllocation.maxPercent}
              onChange={(value) => updateAllocation(AssetClass.CRYPTO, "maxPercent", value)}
            />
          ) : null}
        </div>
      </Card>

      {actionState.message ? (
        <div className={cn(
          "flex items-center gap-2 rounded-lg border p-3 text-sm",
          actionState.ok
            ? "border-success/30 bg-success/10 text-success"
            : "border-destructive/30 bg-destructive/10 text-destructive",
        )}>
          {actionState.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
          {actionState.message}
        </div>
      ) : null}

      <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg shadow-background/40 backdrop-blur lg:bottom-4">
        <p className="text-sm text-muted">
          {isDirty ? "You have unsaved strategy changes." : `Saved ${formatUtcTimestamp(strategy.updatedAt)}`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={!isDirty || isPending} onClick={() => setDraft(initialDraft)}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reset to saved
          </Button>
          <Button type="submit" disabled={!isDirty || !analysis.isValid || isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {isPending ? "Saving..." : "Save strategy"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AllocationRow({
  allocation,
  availableAssets,
  onChange,
  onRemove,
  onAddAsset,
  onChangeAsset,
  onRemoveAsset,
}: {
  allocation: StrategyAllocationInput;
  availableAssets: StrategyEditorModel["availableAssets"];
  onChange: (field: AllocationField, value: string) => void;
  onRemove: () => void;
  onAddAsset: (assetId: string) => void;
  onChangeAsset: (assetId: string, value: string) => void;
  onRemoveAsset: (assetId: string) => void;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const targetAssetIds = new Set(allocation.assetTargets.map((target) => target.assetId));
  const addableAssets = availableAssets.filter((asset) => !targetAssetIds.has(asset.id));
  const assetById = new Map(availableAssets.map((asset) => [asset.id, asset]));
  const assetTotal = allocation.assetTargets.reduce((sum, target) => sum + safeBasisPoints(target.targetPercent), 0);
  const effectiveSelectedAssetId = selectedAssetId || addableAssets[0]?.id || "";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground">{formatAssetClass(allocation.assetClass)}</h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${formatAssetClass(allocation.assetClass)} allocation`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-destructive/50 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        {(Object.keys(allocationLabels) as AllocationField[]).map((field) => (
          <label key={field} className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted">{allocationLabels[field]}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={sliderValue(allocation[field])}
              onChange={(event) => onChange(field, event.target.value)}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <div className="relative mt-2">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={allocation[field]}
                onChange={(event) => onChange(field, event.target.value)}
                className={`${inputClassName} pr-8`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
            </div>
          </label>
        ))}
      </div>
      <div className="mt-5 border-t border-border pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Asset targets</h4>
            <p className="mt-1 text-sm text-muted">Targets inside {formatAssetClass(allocation.assetClass)} must total 100%.</p>
          </div>
          <Badge tone={assetTotal === 10_000 ? "success" : "warning"}>Asset total: {(assetTotal / 100).toFixed(2)}%</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {allocation.assetTargets.map((target) => {
            const asset = assetById.get(target.assetId);
            return (
              <div key={target.assetId} className="grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_2.75rem] md:items-end">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{asset?.symbol ?? "Unknown asset"}</p>
                  <p className="mt-1 truncate text-xs text-muted">{asset?.name ?? target.assetId}</p>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted">Target inside class</span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      value={target.targetPercent}
                      onChange={(event) => onChangeAsset(target.assetId, event.target.value)}
                      className={`${inputClassName} pr-8`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => onRemoveAsset(target.assetId)}
                  aria-label={`Remove ${asset?.symbol ?? "asset"} target`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted transition hover:border-destructive/50 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        {addableAssets.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select
              value={effectiveSelectedAssetId}
              onChange={(event) => setSelectedAssetId(event.target.value)}
              className={`${inputClassName} sm:flex-1`}
            >
              {addableAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>
              ))}
            </select>
            <Button type="button" variant="secondary" onClick={() => {
              onAddAsset(effectiveSelectedAssetId);
              setSelectedAssetId("");
            }}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add asset
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RuleToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-4">
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-primary" : "bg-surface-strong")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition", checked ? "left-6" : "left-1")} />
      </span>
    </label>
  );
}

function NumberRule({ label, description, value, onChange }: { label: string; description: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="rounded-lg border border-border bg-surface p-4">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="mt-1 block min-h-10 text-sm text-muted">{description}</span>
      <div className="relative mt-3">
        <input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClassName} pr-8`} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
      </div>
    </label>
  );
}

function createDraft(strategy: StrategyEditorModel): Draft {
  return {
    id: strategy.id,
    name: strategy.name,
    allocations: strategy.allocations.map((allocation) => ({
      assetClass: allocation.assetClass,
      targetPercent: allocation.targetPercent,
      minPercent: allocation.minPercent,
      maxPercent: allocation.maxPercent,
      assetTargets: allocation.assetTargets.map((assetTarget) => ({
        assetId: assetTarget.assetId,
        targetPercent: assetTarget.targetPercent,
      })),
    })),
    rules: { ...strategy.rules },
  };
}

function sliderValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

function safeBasisPoints(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function formatAssetClass(assetClass: AssetClass) {
  if (assetClass === AssetClass.CRYPTO) return "Crypto";
  if (assetClass === AssetClass.GOLD) return "Gold";
  if (assetClass === AssetClass.CASH) return "Cash";
  return assetClass;
}

const inputClassName = "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
