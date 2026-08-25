"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, BarChart3, RotateCcw, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { previewMarketScenarioAction, previewTransactionScenarioAction } from "@/features/scenarios/actions";
import { classLabel, formatCurrency, formatPercent, scenarioWarningText, statusLabel } from "@/features/scenarios/presentation";
import { scenarioPresets } from "@/features/scenarios/presets";
import type { ScenariosPageModel } from "@/features/scenarios/read-model";
import { scenarioBuckets, type MarketScenarioResult, type ScenarioBucket, type TransactionScenarioResult } from "@/features/scenarios/types";
import { cn } from "@/lib/utils";
import { decimalSign } from "@/lib/format/decimal";

type Mode = "TRANSACTION" | "MARKET";
type ShockDraft = Record<ScenarioBucket, string>;

const emptyShocks: ShockDraft = { ETF: "0", BTC: "0", ETH: "0", GOLD: "0", CASH: "0" };
export function ScenariosClient({ model }: { model: ScenariosPageModel }) {
  const [mode, setMode] = useState<Mode>("TRANSACTION");
  return (
    <div className="space-y-4">
      {model.isPartial ? <Notice>Current valuation is partial. Missing prices: {model.missingPriceSymbols.join(", ")}.</Notice> : null}
      <div className="grid w-full grid-cols-2 rounded-lg border border-border bg-card p-1 sm:inline-flex sm:w-auto">
        <ModeButton active={mode === "TRANSACTION"} onClick={() => setMode("TRANSACTION")} icon={<ShoppingCart className="h-4 w-4" />}>Transaction Simulator</ModeButton>
        <ModeButton active={mode === "MARKET"} onClick={() => setMode("MARKET")} icon={<BarChart3 className="h-4 w-4" />}>Market Scenario</ModeButton>
      </div>
      {mode === "TRANSACTION" ? <TransactionSimulator model={model} /> : <MarketSimulator model={model} />}
    </div>
  );
}

function TransactionSimulator({ model }: { model: ScenariosPageModel }) {
  const [assetId, setAssetId] = useState(model.assets[0]?.id ?? "");
  const [type, setType] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<TransactionScenarioResult | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    setError("");
    startTransition(async () => {
      const response = await previewTransactionScenarioAction({ assetId, type, amount });
      if (!response.ok) return setError(response.message);
      setResult(response.data);
    });
  }
  function reset() {
    setAssetId(model.assets[0]?.id ?? ""); setType("BUY"); setAmount(""); setResult(null); setError("");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.4fr]">
      <Card className="h-fit">
        <SectionHeading icon={<ShoppingCart className="h-5 w-5" />} title="Transaction Simulator" description="Model an external investment or withdrawal at the current market price." />
        <div className="mt-6 space-y-4">
          <Field label="Asset"><select value={assetId} onChange={(event) => { setAssetId(event.target.value); setResult(null); }} className={inputClass}>{model.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.symbol}{asset.hasPrice ? "" : " · price unavailable"}</option>)}</select></Field>
          <Field label="Transaction"><div className="grid grid-cols-2 gap-2">{(["BUY", "SELL"] as const).map((item) => <button type="button" key={item} onClick={() => { setType(item); setResult(null); }} className={cn("min-h-11 rounded-lg border text-sm font-medium", type === item ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface text-muted")}>{item}</button>)}</div></Field>
          <Field label="Amount in EUR"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">€</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setResult(null); }} placeholder="500.00" className={cn(inputClass, "pl-7")} /></div></Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!model.hasStrategy ? <Notice>Create an active strategy before running transaction scenarios.</Notice> : null}
          <div className="flex gap-2"><Button type="button" onClick={run} disabled={pending || !assetId || !amount || !model.hasStrategy} className="flex-1">{pending ? "Calculating…" : "Run simulation"}</Button><Button type="button" variant="secondary" onClick={reset} aria-label="Reset"><RotateCcw className="h-4 w-4" /></Button></div>
        </div>
      </Card>
      {result ? <TransactionResult result={result} currency={model.currency} onModify={() => setResult(null)} onReset={reset} /> : <ScenarioEmpty title="No transaction simulated" description="Choose an asset, transaction type, and EUR amount to compare allocation before and after." />}
    </div>
  );
}

function TransactionResult({ result, currency, onModify, onReset }: { result: TransactionScenarioResult; currency: string; onModify: () => void; onReset: () => void }) {
  const afterByClass = new Map(result.afterComparison.map((item) => [item.assetClass, item]));
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><ValueCard label="Current portfolio value" value={result.current.totalValue} currency={currency} /><ValueCard label="Projected portfolio value" value={result.projected.totalValue} currency={currency} detail={`${result.type} ${result.quantity} ${result.symbol}`} /></div>
    <Card><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><SectionHeading icon={<SlidersHorizontal className="h-5 w-5" />} title="Allocation before / after" description="Compared with your active strategy ranges." /><Badge>{result.type} {formatCurrency(result.amount, currency)}</Badge></div>
      <div className="mt-5 hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="pb-3">Asset class</th><th className="pb-3">Current</th><th className="pb-3">After</th><th className="pb-3">Target range</th><th className="pb-3">Status</th></tr></thead><tbody className="divide-y divide-border">{result.beforeComparison.map((before) => { const after = afterByClass.get(before.assetClass)!; return <tr key={before.assetClass}><td className="py-3 font-medium">{classLabel(before.assetClass)}</td><td>{formatPercent(before.currentPercent)}</td><td><span className="inline-flex items-center gap-2">{formatPercent(after.currentPercent)} <ArrowRight className="h-3 w-3 text-muted" /></span></td><td>{formatPercent(after.minPercent)}–{formatPercent(after.maxPercent)}</td><td><StatusBadge status={after.status} /></td></tr>; })}</tbody></table></div>
      <div className="mt-4 space-y-3 md:hidden">{result.beforeComparison.map((before) => { const after = afterByClass.get(before.assetClass)!; return <div key={before.assetClass} className="rounded-lg border border-border bg-surface p-3"><div className="flex items-center justify-between"><p className="font-medium">{classLabel(before.assetClass)}</p><StatusBadge status={after.status} /></div><p className="mt-3 text-sm">{formatPercent(before.currentPercent)} <ArrowRight className="mx-1 inline h-3 w-3" /> {formatPercent(after.currentPercent)}</p><p className="mt-1 text-xs text-muted">Range {formatPercent(after.minPercent)}–{formatPercent(after.maxPercent)}</p></div>; })}</div>
    </Card>
    <Card><h2 className="font-semibold">Strategy warnings</h2>{result.warnings.length ? <div className="mt-4 space-y-2">{result.warnings.map((warning) => <Notice key={warning.code}>{scenarioWarningText(warning)}</Notice>)}</div> : <p className="mt-3 text-sm text-muted">No projected strategy violations.</p>}{result.reasonCodes.includes("PARTIAL_VALUATION") ? <p className="mt-3 text-xs text-warning">Results use only holdings with available prices.</p> : null}<div className="mt-5 flex gap-2"><Button type="button" variant="secondary" onClick={onModify}>Modify</Button><Button type="button" variant="ghost" onClick={onReset}>Reset</Button></div></Card>
  </div>;
}

function MarketSimulator({ model }: { model: ScenariosPageModel }) {
  const [shocks, setShocks] = useState<ShockDraft>(emptyShocks);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [result, setResult] = useState<MarketScenarioResult | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function update(bucket: ScenarioBucket, value: string) { setShocks((current) => ({ ...current, [bucket]: value })); setResult(null); setActivePreset(null); }
  function applyPreset(name: string, values: ShockDraft) { setShocks({ ...values }); setActivePreset(name); setResult(null); setError(""); }
  function run() { setError(""); startTransition(async () => { const response = await previewMarketScenarioAction({ shocks }); if (!response.ok) return setError(response.message); setResult(response.data); }); }
  function reset() { setShocks(emptyShocks); setActivePreset(null); setResult(null); setError(""); }
  return <div className="space-y-4">
    <Notice>Scenario simulations are hypothetical and are not forecasts.</Notice>
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
      <Card className="h-fit"><SectionHeading icon={<BarChart3 className="h-5 w-5" />} title="Market Scenario" description="Apply editable price shocks to your currently valued holdings." />
        <div className="mt-5"><p className="text-xs uppercase tracking-wide text-muted">Presets</p><div className="mt-2 grid grid-cols-2 gap-2">{scenarioPresets.map((preset) => <button type="button" key={preset.name} onClick={() => applyPreset(preset.name, preset.shocks)} className={cn("min-h-11 rounded-lg border px-3 py-2 text-left text-xs font-medium", activePreset === preset.name ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface text-muted hover:text-foreground")}>{preset.name}</button>)}</div></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">{scenarioBuckets.map((bucket) => <Field key={bucket} label={bucket === "GOLD" ? "Gold" : bucket === "CASH" ? "Cash" : bucket}><div className="relative"><input type="number" min="-100" max="1000" step="0.01" value={shocks[bucket]} onChange={(event) => update(bucket, event.target.value)} className={cn(inputClass, "pr-8")} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span></div></Field>)}</div>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}<div className="mt-5 flex gap-2"><Button type="button" onClick={run} disabled={pending} className="flex-1">{pending ? "Calculating…" : "Run scenario"}</Button><Button type="button" variant="secondary" onClick={reset} aria-label="Reset"><RotateCcw className="h-4 w-4" /></Button></div>
      </Card>
      {result ? <MarketResult result={result} currency={model.currency} /> : <ScenarioEmpty title="No market scenario applied" description="Choose a transparent preset or edit each price shock, then run the scenario." />}
    </div>
  </div>;
}

function MarketResult({ result, currency }: { result: MarketScenarioResult; currency: string }) {
  const chart = result.contributions.map((item) => ({ name: item.bucket === "GOLD" ? "Gold" : item.bucket === "CASH" ? "Cash" : item.bucket, value: Number(item.amount) }));
  return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><ValueCard label="Current portfolio value" value={result.currentValue} currency={currency} /><ValueCard label="Scenario portfolio value" value={result.scenarioValue} currency={currency} detail={`${(decimalSign(result.absoluteChange) ?? 0) >= 0 ? "+" : ""}${formatCurrency(result.absoluteChange, currency)} · ${result.percentageChange === null ? "change unavailable" : formatPercent(result.percentageChange)}`} tone={(decimalSign(result.absoluteChange) ?? 0) >= 0 ? "positive" : "negative"} /></div>
    <Card><h2 className="font-semibold">Contribution to gain / loss</h2><p className="mt-1 text-sm text-muted">Impact from each editable scenario bucket.</p><div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 10, right: 5, left: 5, bottom: 5 }}><CartesianGrid stroke="#282d3d" vertical={false} /><XAxis dataKey="name" tick={{ fill: "#9298aa", fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#9298aa", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => compactCurrency(Number(value), currency)} /><ReferenceLine y={0} stroke="#64748b" /><Tooltip formatter={(value) => formatCurrency(String(value ?? 0), currency)} contentStyle={{ background: "#171a26", border: "1px solid #282d3d", borderRadius: 8 }} /><Bar dataKey="value" radius={[5, 5, 0, 0]}>{chart.map((item) => <Cell key={item.name} fill={item.value >= 0 ? "#22c55e" : "#ef4444"} />)}</Bar></BarChart></ResponsiveContainer></div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{result.contributions.map((item) => <div key={item.bucket} className="rounded-lg bg-surface p-3"><p className="text-xs text-muted">{item.bucket}</p><p className={cn("mt-1 text-sm font-semibold", decimalSign(item.amount) === 1 ? "text-success" : decimalSign(item.amount) === -1 ? "text-destructive" : "")}>{formatCurrency(item.amount, currency)}</p><p className="mt-1 text-xs text-muted">{formatPercent(item.shockPercent)}</p></div>)}</div>
      {result.isPartial ? <p className="mt-4 text-xs text-warning">Partial scenario. Missing prices: {result.missingPriceSymbols.join(", ")}.</p> : null}
    </Card></div>;
}

function ModeButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={cn("flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium leading-4 transition sm:flex-none sm:gap-2 sm:px-4 sm:text-sm", active ? "bg-primary text-white" : "text-muted hover:text-foreground")}>{icon}<span>{children}</span></button>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-xs uppercase tracking-wide text-muted">{label}</span>{children}</label>; }
function SectionHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">{icon}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div></div>; }
function ValueCard({ label, value, currency, detail, tone }: { label: string; value: string; currency: string; detail?: string; tone?: "positive" | "negative" }) { return <Card><p className="text-sm text-muted">{label}</p><p className="mt-3 break-words text-2xl font-semibold">{formatCurrency(value, currency)}</p>{detail ? <p className={cn("mt-2 text-sm text-muted", tone === "positive" && "text-success", tone === "negative" && "text-destructive")}>{detail}</p> : null}</Card>; }
function StatusBadge({ status }: { status: "UNDERWEIGHT" | "IN_RANGE" | "OVERWEIGHT" }) { return <Badge tone={status === "IN_RANGE" ? "success" : status === "OVERWEIGHT" ? "destructive" : "warning"}>{statusLabel(status)}</Badge>; }
function Notice({ children }: { children: React.ReactNode }) { return <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>; }
function ScenarioEmpty({ title, description }: { title: string; description: string }) { return <Card className="flex min-h-72 items-center justify-center border-dashed"><div className="max-w-sm text-center"><BarChart3 className="mx-auto h-7 w-7 text-primary" /><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{description}</p></div></Card>; }
function compactCurrency(value: number, currency: string) { return new Intl.NumberFormat("en-IE", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value); }
const inputClass = "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition focus:border-primary/60";
