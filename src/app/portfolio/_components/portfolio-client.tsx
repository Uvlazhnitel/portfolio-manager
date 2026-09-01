"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, ChartNoAxesCombined, ChevronDown, ChevronRight, ChevronUp, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { searchAssetsAction } from "@/features/asset-catalog/actions";
import type { AssetCatalogResult } from "@/features/asset-catalog/types";
import type { AssetCatalogKind } from "@/features/asset-catalog/types";
import {
  createAccountAction,
  createPositionAction,
  createTradeAction,
  createTransferAction,
  createTransactionAction,
  deleteTransactionGroupAction,
  deleteTransactionAction,
  linkAssetQuoteAction,
  updateTradeAction,
  updateTransferAction,
  updateTransactionAction,
} from "@/features/portfolio/actions";
import type { PortfolioReadModel } from "@/features/portfolio/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartRangeSelector, chartRangeLabel, defaultChartRange, filterChartRowsByRange, type ChartRange } from "@/components/ui/chart-range-selector";
import { DataQualitySummary, type DataQualityItem } from "@/components/ui/data-quality-summary";
import { EmptyState } from "@/components/ui/empty-state";
import { PnlIndicator } from "@/components/ui/pnl-indicator";
import { cn } from "@/lib/utils";
import { formatDecimalCurrency } from "@/lib/format/decimal";
import { formatUtcDate, formatUtcTimestamp } from "@/lib/format/date";

type PortfolioTab = "holdings" | "accounts" | "transactions";
type DialogState =
  | { kind: "asset" }
  | { kind: "account" }
  | { kind: "transaction"; assetId?: string; accountId?: string }
  | { kind: "edit-transaction"; transactionId: string }
  | null;
type AssetSelection = AssetCatalogResult | { source: "CUSTOM" };
type TransactionOperation = "INITIAL_BALANCE" | "GIFT" | "BUY" | "SELL" | "TRANSFER" | "TRADE" | "DEPOSIT" | "WITHDRAWAL";

type PortfolioInitialDialog = "asset" | null;
type PortfolioClientProps = { portfolio: PortfolioReadModel; initialDialog?: PortfolioInitialDialog };

const accountTypes = ["EXCHANGE", "BROKER", "WALLET", "PHYSICAL", "BANK", "OTHER"] as const;
const assetClasses = ["ETF", "CRYPTO", "GOLD", "CASH", "OTHER"] as const;
const assetTypes = ["CRYPTO", "ETF", "PHYSICAL_GOLD", "TOKENIZED_GOLD", "FIAT", "STABLECOIN", "OTHER"] as const;
const operationChoices: Array<[TransactionOperation, string]> = [
  ["INITIAL_BALANCE", "Current balance"],
  ["GIFT", "Gift"],
  ["BUY", "Buy"],
  ["SELL", "Sell"],
  ["TRANSFER", "Transfer"],
  ["TRADE", "Trade"],
  ["DEPOSIT", "Deposit"],
  ["WITHDRAWAL", "Withdrawal"],
];

export function PortfolioClient({ portfolio, initialDialog = null }: PortfolioClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PortfolioTab>("holdings");
  const [dialog, setDialog] = useState<DialogState>(initialDialog ? { kind: initialDialog } : null);
  const [dialogOpenedFromUrl, setDialogOpenedFromUrl] = useState(Boolean(initialDialog));
  const dataQualityItems = portfolioDataQualityItems(portfolio);
  const closeDialog = useCallback(() => {
    setDialog(null);
    if (dialogOpenedFromUrl) {
      setDialogOpenedFromUrl(false);
      router.replace("/portfolio", { scroll: false });
    }
  }, [dialogOpenedFromUrl, router]);

  return (
    <div className="space-y-4">
      <form id="open-add-asset" action={() => setDialog({ kind: "asset" })} />

      <PortfolioOverview portfolio={portfolio} dataQualityItems={dataQualityItems} />

      {portfolio.strategyStatus ? <StrategySummary portfolio={portfolio} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {(["holdings", "accounts", "transactions"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "min-h-11 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition",
              activeTab === tab ? "border-primary/35 bg-primary/15 text-foreground" : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "holdings" ? (
        <HoldingsSection portfolio={portfolio} onAddTransaction={(assetId, accountId) => setDialog({ kind: "transaction", assetId, accountId })} />
      ) : null}
      {activeTab === "accounts" ? <AccountsSection portfolio={portfolio} onAddAccount={() => setDialog({ kind: "account" })} /> : null}
      {activeTab === "transactions" ? (
        <TransactionsSection portfolio={portfolio} onAddTransaction={() => setDialog({ kind: "transaction" })} onEditTransaction={(transactionId) => setDialog({ kind: "edit-transaction", transactionId })} />
      ) : null}

      {dialog?.kind === "asset" ? <AddAssetDialog portfolio={portfolio} onClose={closeDialog} /> : null}
      {dialog?.kind === "account" ? <AddAccountDialog custodians={portfolio.custodians} onClose={closeDialog} /> : null}
      {dialog?.kind === "transaction" ? (
        <AddTransactionDialog portfolio={portfolio} initialAssetId={dialog.assetId} initialAccountId={dialog.accountId} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === "edit-transaction" ? (
        <EditTransactionDialog portfolio={portfolio} transactionId={dialog.transactionId} onClose={closeDialog} />
      ) : null}
    </div>
  );
}

function PortfolioOverview({ portfolio, dataQualityItems }: PortfolioClientProps & { dataQualityItems: DataQualityItem[] }) {
  const { valuation } = portfolio;
  return (
    <Card className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">Portfolio value</p>
          <p className="mt-5 break-words text-5xl font-semibold text-foreground sm:text-6xl">
            {formatCurrency(valuation.totalValue, valuation.currency)}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:min-w-64 lg:flex-col lg:items-end">
          <div className="min-w-0 lg:text-right">
            <p className="text-xs uppercase tracking-wide text-muted">Last updated</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-muted">{formatTimestamp(valuation.lastUpdated)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <DataQualitySummary items={dataQualityItems} className="[&_summary]:min-h-10" />
            <Link href="/performance" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-muted transition hover:border-primary/50 hover:text-foreground">
              Performance <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-5 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryMetric label="Net invested" value={formatCurrency(valuation.netInvested, valuation.currency)} emphasis="primary" />
        <SummaryMetric label="Investment gain" value={valuation.investmentGain ? formatMoneyWithSign(valuation.investmentGain, valuation.currency) : "Unavailable"} tone={moneyTone(valuation.investmentGain)} emphasis="primary" />
        <SummaryMetric label="Return on tracked capital" value={valuation.trackedCapitalReturnPercent ? formatPercentWithSign(valuation.trackedCapitalReturnPercent) : "Unavailable"} tone={moneyTone(valuation.trackedCapitalReturnPercent)} emphasis="primary" />
        <SummaryMetric label="Tracked capital" value={formatCurrency(valuation.trackedCapital, valuation.currency)} />
        <SummaryMetric label="Opening basis (known)" value={formatCurrency(valuation.openingBasis, valuation.currency)} />
        <SummaryMetric label="Gift tracking basis" value={formatCurrency(valuation.giftTrackingBasis, valuation.currency)} />
      </dl>
    </Card>
  );
}

function SummaryMetric({ label, value, tone = "default", muted = false, emphasis = "secondary" }: { label: string; value: ReactNode; tone?: "default" | "positive" | "negative"; muted?: boolean; emphasis?: "primary" | "secondary" }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm leading-5 text-muted">{label}</dt>
      <dd className={cn(
        "mt-2 break-words font-semibold tabular-nums text-foreground",
        emphasis === "primary" ? "text-2xl" : "text-xl",
        muted && "text-muted",
        tone === "positive" && "text-success",
        tone === "negative" && "text-destructive",
      )}>
        {value}
      </dd>
    </div>
  );
}

function StrategySummary({ portfolio }: PortfolioClientProps) {
  const status = portfolio.strategyStatus;
  if (!status) return null;
  if (status.state === "UNAVAILABLE") {
    return (
      <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">Strategy · {status.name}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">Allocation unavailable</p>
          <p className="mt-2 text-sm leading-5 text-muted">Missing prices for {status.missingPriceSymbols.join(", ")}. Current weights and strategy drift are hidden until valuation is complete.</p>
        </div>
        <Link href="/plan/strategy" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-muted transition hover:border-primary/50 hover:text-foreground">
          Strategy <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Card>
    );
  }
  const problemClasses = status.comparisons
    .filter((comparison) => comparison.status !== "IN_RANGE")
    .sort((a, b) => Math.abs(Number(b.currentPercent) - Number(b.targetPercent)) - Math.abs(Number(a.currentPercent) - Number(a.targetPercent)))
    .slice(0, 3);

  return (
    <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted">Strategy · {status.name}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">
          {status.inRangeCount}/{status.totalCount} classes in range
        </p>
      </div>
      <div className="min-w-0 flex-1">
        {problemClasses.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-3">
            {problemClasses.map((comparison) => (
              <div key={comparison.assetClass} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="truncate text-foreground">{comparison.assetClass}</span>
                <span className={cn("shrink-0 font-medium", comparison.status === "OVERWEIGHT" ? "text-destructive" : "text-warning")}>
                  {comparison.status === "OVERWEIGHT" ? "Over" : "Under"} {formatPercentWithSign(String(Number(comparison.currentPercent) - Number(comparison.targetPercent)))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">All active classes are inside their configured ranges.</p>
        )}
      </div>
      <Link href="/plan/strategy" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-muted transition hover:border-primary/50 hover:text-foreground">
        Strategy <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}

function AddAssetDialog({ portfolio, onClose }: PortfolioClientProps & { onClose: () => void }) {
  const [selection, setSelection] = useState<AssetSelection | null>(null);
  const [query, setQuery] = useState("");
  const [catalogKind, setCatalogKind] = useState<AssetCatalogKind>("CRYPTO");
  const [remoteResults, setRemoteResults] = useState<AssetCatalogResult[] | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [isSearchPending, startSearch] = useTransition();
  const requestId = useRef(0);
  const [entryKey, setEntryKey] = useState(0);
  const [accountId, setAccountId] = useState(portfolio.accounts[0]?.id ?? "");
  const trimmedQuery = query.trim();
  const minimumSearchLength = catalogKind === "ETF" ? 3 : 2;
  const canSearchRemote = trimmedQuery.length >= minimumSearchLength && !isSearchPending;
  const localAssets = useMemo(() => portfolio.assets.map(toCatalogResult), [portfolio.assets]);
  const visibleLocal = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    return localAssets
      .filter((asset) => catalogKind === "ETF" ? asset.assetType === "ETF" : asset.assetType !== "ETF")
      .filter((asset) => !needle || asset.symbol.toLowerCase().includes(needle) || asset.name.toLowerCase().includes(needle));
  }, [catalogKind, localAssets, trimmedQuery]);

  const runRemoteSearch = useCallback((searchQuery = trimmedQuery) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < minimumSearchLength || isSearchPending) {
      return;
    }
    const currentRequest = ++requestId.current;
    startSearch(async () => {
      const result = await searchAssetsAction(trimmed, catalogKind);
      if (requestId.current !== currentRequest) return;
      setRemoteResults(result.results);
      setSearchMessage(result.message);
      setSearchWarning(result.warning);
    });
  }, [catalogKind, isSearchPending, minimumSearchLength, trimmedQuery]);

  useEffect(() => {
    if (catalogKind !== "CRYPTO" || trimmedQuery.length < minimumSearchLength) {
      return;
    }
    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        const result = await searchAssetsAction(trimmedQuery, catalogKind);
        if (requestId.current !== currentRequest) return;
        setRemoteResults(result.results);
        setSearchMessage(result.message);
        setSearchWarning(result.warning);
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [catalogKind, minimumSearchLength, trimmedQuery]);

  const results = remoteResults ?? visibleLocal;

  return (
    <DialogShell title="Add transaction" description={selection ? "Record a current balance, historical buy, or sale." : "First choose the asset."} onClose={onClose}>
      {selection ? (
        <PositionForm key={entryKey} selection={selection} accounts={portfolio.accounts} accountId={accountId} onAccountIdChange={setAccountId} currency={portfolio.valuation.currency} onDone={onClose} onAddAnother={() => setEntryKey((value) => value + 1)} onBack={() => setSelection(null)} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 rounded-lg border border-border bg-surface p-1" aria-label="Asset catalog">
            {(["CRYPTO", "ETF"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  requestId.current += 1;
                  setCatalogKind(kind);
                  setQuery("");
                  setRemoteResults(null);
                  setSearchMessage(null);
                  setSearchWarning(null);
                }}
                className={cn("min-h-10 rounded-md px-3 text-sm font-medium transition", catalogKind === kind ? "bg-primary text-white" : "text-muted hover:text-foreground")}
              >
                {kind === "ETF" ? "ETFs" : "Coins & tokens"}
              </button>
            ))}
          </div>
          <div className={cn("grid gap-2", catalogKind === "ETF" ? "sm:grid-cols-[1fr_auto]" : "")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  requestId.current += 1;
                  setQuery(nextQuery);
                  setRemoteResults(null);
                  setSearchMessage(null);
                  setSearchWarning(null);
                }}
                onKeyDown={(event) => {
                  if (catalogKind === "ETF" && event.key === "Enter") {
                    event.preventDefault();
                    runRemoteSearch();
                  }
                }}
                className={cn(inputClassName, "pl-10")}
                placeholder={catalogKind === "ETF" ? "Search VWCE, IWDA, CSPX…" : "Search BTC, ETH, XAUT…"}
                aria-label="Search assets"
              />
            </div>
            {catalogKind === "ETF" ? (
              <Button
                type="button"
                onClick={() => runRemoteSearch()}
                disabled={!canSearchRemote}
                className="min-h-11 px-4"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Search
              </Button>
            ) : null}
          </div>

          <div className="min-h-52 space-y-2">
            {isSearchPending ? <p className="px-2 py-4 text-sm text-muted">Searching {catalogKind === "ETF" ? "Alpha Vantage" : "CoinGecko"}…</p> : null}
            {!isSearchPending && results.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">No matching assets found.</p>
            ) : null}
            {!isSearchPending ? results.map((asset) => (
              <AssetResultButton key={assetResultKey(asset)} asset={asset} onSelect={() => setSelection(asset)} />
            )) : null}
          </div>

          {searchMessage ? <p className="text-sm text-destructive">{searchMessage}</p> : null}
          {searchWarning ? <p className="text-sm text-warning">{searchWarning}</p> : null}
          {remoteResults?.some((asset) => asset.source === "COINGECKO") ? (
            <p className="text-xs text-muted">
              Data provided by <a href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer" className="text-primary hover:underline">CoinGecko</a>
            </p>
          ) : null}
          {remoteResults?.some((asset) => asset.source === "TWELVE_DATA" || asset.source === "ALPHA_VANTAGE") ? (
            <p className="text-xs text-muted">
              ETF listings provided by <a href="https://www.alphavantage.co" target="_blank" rel="noreferrer" className="text-primary hover:underline">Alpha Vantage</a>
            </p>
          ) : null}

          <button type="button" onClick={() => setSelection({ source: "CUSTOM" })} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-dashed border-border px-4 text-left text-sm text-muted transition hover:border-primary/50 hover:text-foreground">
            <span>Can&apos;t find it? Add a custom asset</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </DialogShell>
  );
}

function PositionForm({
  selection,
  accounts,
  accountId,
  onAccountIdChange,
  currency,
  onDone,
  onAddAnother,
  onBack,
}: {
  selection: AssetSelection;
  accounts: PortfolioReadModel["accounts"];
  accountId: string;
  onAccountIdChange: (accountId: string) => void;
  currency: string;
  onDone: () => void;
  onAddAnother: () => void;
  onBack: () => void;
}) {
  const isCustom = selection.source === "CUSTOM";
  const asset = isCustom ? null : selection;
  const [assetClass, setAssetClass] = useState(asset?.assetClass ?? "OTHER");
  const [assetType, setAssetType] = useState(asset?.assetType ?? "OTHER");
  const [showAdvanced, setShowAdvanced] = useState(isCustom);
  const isPhysicalGold = asset?.assetType === "PHYSICAL_GOLD" || assetType === "PHYSICAL_GOLD";
  const isCash = (asset?.assetClass ?? assetClass) === "CASH";
  const [type, setType] = useState<TransactionOperation>("BUY");
  const [basisMethod, setBasisMethod] = useState("UNKNOWN");
  const [state, action, isSaving] = useActionState(createPositionAction, { ok: false, message: "" });
  const [transferState, transferAction, isTransferSaving] = useActionState(createTransferAction, { ok: false, message: "" });
  const [linkState, linkAction, isLinking] = useActionState(linkAssetQuoteAction, { ok: false, message: "" });
  const isTransfer = type === "TRANSFER";
  const actionState = isTransfer ? transferState : state;
  const isPending = isTransfer ? isTransferSaving : isSaving;

  if (actionState.ok) {
    return <div className="space-y-5"><div className="rounded-xl border border-success/30 bg-success/10 p-5"><p className="font-medium text-success">Transaction saved</p><p className="mt-2 text-sm text-foreground">{actionState.message}</p><p className="mt-2 text-sm text-muted">Holdings and allocation were recalculated.</p></div><div className="grid gap-2 sm:grid-cols-2"><Button type="button" variant="secondary" onClick={onAddAnother}>Save and add another</Button><Button type="button" onClick={onDone}>Done</Button></div></div>;
  }

  return (
    <form action={isTransfer ? transferAction : action} className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Choose another asset
      </button>

      {asset ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 p-4">
          <AssetAvatar asset={asset} size={44} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{asset.name}</p>
            <p className="text-sm text-muted">{asset.symbol}{asset.exchange ? ` · ${asset.exchange} · ${asset.currency}` : ""}</p>
          </div>
          <Badge tone="primary" className="ml-auto">{asset.assetClass}</Badge>
        </div>
      ) : null}

      <input type="hidden" name="existingAssetId" value={asset?.existingAssetId ?? ""} />
      <input type="hidden" name="type" value={type === "TRANSFER" ? "TRANSFER_OUT" : type} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="newAssetExternalId" value={asset?.externalId ?? ""} />
      <input type="hidden" name="newAssetImageUrl" value={asset?.imageUrl ?? ""} />
      <input type="hidden" name="newAssetQuoteProvider" value={asset?.quoteProvider ?? ""} />
      <input type="hidden" name="newAssetQuoteSymbol" value={asset?.quoteSymbol ?? ""} />
      <input type="hidden" name="newAssetQuoteMicCode" value={asset?.quoteMicCode ?? ""} />
      <input type="hidden" name="assetId" value={asset?.existingAssetId ?? ""} />
      <input type="hidden" name="quoteProvider" value={asset?.quoteProvider ?? ""} />
      <input type="hidden" name="quoteSymbol" value={asset?.quoteSymbol ?? ""} />
      <input type="hidden" name="quoteMicCode" value={asset?.quoteMicCode ?? ""} />
      <input type="hidden" name="quoteCurrency" value={asset?.currency ?? ""} />
      {!isCustom ? (
        <>
          <input type="hidden" name="newAssetSymbol" value={asset?.symbol ?? ""} />
          <input type="hidden" name="newAssetName" value={asset?.name ?? ""} />
          <input type="hidden" name="newAssetCurrency" value={asset?.currency ?? asset?.symbol ?? currency} />
        </>
      ) : null}

      {asset?.source === "TWELVE_DATA" || asset?.source === "ALPHA_VANTAGE" ? (
        <>
          <input type="hidden" name="newAssetClass" value="ETF" />
          <input type="hidden" name="newAssetType" value="ETF" />
        </>
      ) : null}

      {(asset?.source === "TWELVE_DATA" || asset?.source === "ALPHA_VANTAGE") && asset.existingAssetId ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">{formatQuoteIdentity(asset)}</p>
          <Button type="submit" formAction={linkAction} variant="secondary" disabled={isLinking}>
            {isLinking ? "Linking…" : linkState.ok ? "Quote linked" : "Link market quote"}
          </Button>
        </div>
      ) : null}
      {linkState.message ? <ActionMessage state={linkState} /> : null}

      {isCustom ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset name"><input name="newAssetName" required className={inputClassName} placeholder="Vanguard FTSE All-World" /></Field>
          <Field label="Symbol"><input name="newAssetSymbol" required className={inputClassName} placeholder="VWCE" /></Field>
          <Field label="Asset currency"><input name="newAssetCurrency" required className={inputClassName} defaultValue={currency} /></Field>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {operationChoices.filter(([value]) => value !== "TRADE").map(([value, label]) => (
          <Button key={value} type="button" variant={type === value ? "primary" : "secondary"} disabled={(value === "SELL" || value === "TRANSFER" || value === "WITHDRAWAL") && !asset?.existingAssetId} onClick={() => { setType(value); setBasisMethod(value === "GIFT" ? "ZERO_COST" : "UNKNOWN"); }}>{label}</Button>
        ))}
      </div>
      {type === "SELL" && !asset?.existingAssetId ? <p className="text-sm text-warning">Add a starting balance or earlier buy first.</p> : null}
      {(type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash ? <p className="text-sm text-warning">Deposits and withdrawals are only available for CASH assets.</p> : null}
      {type === "TRANSFER" && !asset?.existingAssetId ? <p className="text-sm text-warning">Create the asset first, then transfer it between accounts.</p> : null}

      {asset?.source === "COINGECKO" || isCustom ? (
        <div>
          {!isCustom ? (
            <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="min-h-11 text-sm text-muted hover:text-foreground">
              {showAdvanced ? "Hide advanced classification" : "Advanced classification"}
            </button>
          ) : null}
          {showAdvanced ? (
            <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
              <Field label="Asset class">
                <select name="newAssetClass" className={inputClassName} value={assetClass} onChange={(event) => setAssetClass(event.target.value as AssetCatalogResult["assetClass"])}>
                  {assetClasses.map((value) => <option key={value} value={value}>{formatType(value)}</option>)}
                </select>
              </Field>
              <Field label="Asset type">
                <select name="newAssetType" className={inputClassName} value={assetType} onChange={(event) => setAssetType(event.target.value as AssetCatalogResult["assetType"])}>
                  {assetTypes.map((value) => <option key={value} value={value}>{formatType(value)}</option>)}
                </select>
              </Field>
              <p className="text-xs text-muted sm:col-span-2">Change this for stablecoins, tokenized gold, ETFs, fiat, or other custom assets.</p>
            </div>
          ) : (
            <>
              <input type="hidden" name="newAssetClass" value={assetClass} />
              <input type="hidden" name="newAssetType" value={assetType} />
            </>
          )}
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Create an account first, then add the asset.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {type === "INITIAL_BALANCE" ? <Field label="Opening acquisition basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="UNKNOWN">Unknown</option><option value="KNOWN_COST">Known cost</option></select></Field> : null}
          {type === "GIFT" ? <Field label="Gift tracking basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="ZERO_COST">Zero cost</option><option value="FAIR_VALUE">Fair value at receipt</option></select></Field> : null}
          <Field label={isTransfer ? "From account" : "Where do you hold it?"}>
            <select name={isTransfer ? "fromAccountId" : "accountId"} required className={inputClassName} value={accountId || preferredAccountId(accounts, isPhysicalGold)} onChange={(event) => onAccountIdChange(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </Field>
          {isTransfer ? (
            <Field label="To account">
              <select name="toAccountId" required className={inputClassName} defaultValue={accounts.find((account) => account.id !== (accountId || preferredAccountId(accounts, isPhysicalGold)))?.id ?? ""}>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </Field>
          ) : null}
          {isPhysicalGold ? (
            <Field label="Weight (troy oz)"><input name="physicalGoldWeightTroyOunces" required className={inputClassName} inputMode="decimal" placeholder="0.1743" /></Field>
          ) : (
            <Field label={type === "DEPOSIT" || type === "WITHDRAWAL" ? "Cash amount" : `How much do you own${asset?.symbol ? ` (${asset.symbol})` : ""}?`}><input name="quantity" required className={inputClassName} inputMode="decimal" placeholder="0.25" /></Field>
          )}
          {!isTransfer && !(type === "INITIAL_BALANCE" && basisMethod === "UNKNOWN") && !(type === "GIFT" && basisMethod === "ZERO_COST") ? <Field label={type === "INITIAL_BALANCE" ? "Known total acquisition cost" : type === "GIFT" ? "Fair value at receipt" : type === "BUY" || type === "DEPOSIT" ? "Total spent" : "Total received"}>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">{currency === "USD" ? "$" : currency}</span><input name="totalAmount" className={cn(inputClassName, "pl-8")} inputMode="decimal" placeholder="12000.00" /></div>
          </Field> : null}
          <Field label={type === "INITIAL_BALANCE" ? "Balance date" : "Transaction date"}><input name="executedAt" required type="date" className={inputClassName} defaultValue={today()} /></Field>
          {type !== "INITIAL_BALANCE" && type !== "GIFT" && !isTransfer ? <Field label={isPhysicalGold ? "Price per troy ounce (alternative)" : "Price per unit (alternative)"}><input name="pricePerUnit" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
          {type !== "INITIAL_BALANCE" && type !== "GIFT" && !isTransfer && type !== "DEPOSIT" && type !== "WITHDRAWAL" ? <Field label="Fee (optional)"><input name="fee" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
        </div>
      )}

      {isPhysicalGold ? <p className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-muted">Physical gold uses troy ounces (oz), the precious-metals unit. Values are normalized server-side for deterministic calculations.</p> : null}
      {isTransfer ? <p className="text-xs text-muted">Transfers move quantity and cost basis between accounts without creating a sale.</p> : null}
      {type === "DEPOSIT" || type === "WITHDRAWAL" ? <p className="text-xs text-muted">Deposits and withdrawals are tracked as external cashflows, separately from Net invested.</p> : null}
      {type === "INITIAL_BALANCE" && basisMethod === "UNKNOWN" ? <p className="text-xs text-muted">The holding remains valued, but its component is excluded from gain and return until a basis is entered.</p> : null}
      {type === "GIFT" ? <p className="text-xs text-muted">Gifts add holdings without creating an external contribution or changing Net invested.</p> : null}
      {type !== "INITIAL_BALANCE" && type !== "GIFT" && !isTransfer ? <p className="text-xs text-muted">Enter price per unit or the gross total. If you enter both, they must agree within one cent. Fee is stored separately.</p> : null}
      <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} /></Field>
      <ActionMessage state={actionState} />
      <Button type="submit" disabled={isPending || accounts.length === 0 || (isTransfer && (!asset?.existingAssetId || accounts.length < 2)) || ((type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash)} className="w-full sm:w-auto">
        {isPending ? "Saving…" : "Save transaction"}
      </Button>
    </form>
  );
}

function AddAccountDialog({ custodians, onClose }: { custodians: PortfolioReadModel["custodians"]; onClose: () => void }) {
  const [state, action, isPending] = useActionState(createAccountAction, { ok: false, message: "" });
  return (
    <DialogShell title="Add account" description="Create a place where assets are held." onClose={onClose}>
      {state.ok ? (
        <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form action={action} className="space-y-4">
          <Field label="Name"><input name="name" required className={inputClassName} placeholder="Ledger, bank, wallet…" /></Field>
          <Field label="Type"><select name="type" className={inputClassName} defaultValue="OTHER">{accountTypes.map((type) => <option key={type} value={type}>{formatType(type)}</option>)}</select></Field>
          <Field label="Custodian (optional)"><select name="custodianId" className={inputClassName} defaultValue=""><option value="">Unassigned</option>{custodians.map((custodian) => <option key={custodian.id} value={custodian.id}>{custodian.name} · {formatType(custodian.category)}</option>)}</select></Field>
          <Field label="Description (optional)"><textarea name="description" className={textareaClassName} rows={3} /></Field>
          <ActionMessage state={state} />
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">{isPending ? "Saving…" : "Create account"}</Button>
        </form>
      )}
    </DialogShell>
  );
}

function AddTransactionDialog({ portfolio, initialAssetId, initialAccountId, onClose }: PortfolioClientProps & { initialAssetId?: string; initialAccountId?: string; onClose: () => void }) {
  const [type, setType] = useState<TransactionOperation>("BUY");
  const [basisMethod, setBasisMethod] = useState("UNKNOWN");
  const [assetId, setAssetId] = useState(initialAssetId ?? portfolio.assets[0]?.id ?? "");
  const [accountId, setAccountId] = useState(initialAccountId ?? portfolio.accounts[0]?.id ?? "");
  const [state, action, isPending] = useActionState(createTransactionAction, { ok: false, message: "" });
  const [transferState, transferAction, isTransferPending] = useActionState(createTransferAction, { ok: false, message: "" });
  const asset = portfolio.assets.find((candidate) => candidate.id === assetId);
  const isPhysicalGold = asset?.assetType === "PHYSICAL_GOLD";
  const isCash = asset?.assetClass === "CASH";
  const isTransfer = type === "TRANSFER";
  const actionState = isTransfer ? transferState : state;
  const pending = isTransfer ? isTransferPending : isPending;

  if (type === "TRADE") {
    return (
      <DialogShell title="Add trade" description="Convert one portfolio asset into another." onClose={onClose}>
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {operationChoices.map(([choice, label]) => <Button key={choice} type="button" variant={type === choice ? "primary" : "secondary"} onClick={() => setType(choice)}>{label}</Button>)}
        </div>
        <TradeForm portfolio={portfolio} onDone={onClose} initialSourceAssetId={assetId} initialSourceAccountId={accountId} />
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Add transaction" description="Record a specific purchase or sale." onClose={onClose}>
      {actionState.ok ? (
        <div className="space-y-4"><ActionMessage state={actionState} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form action={isTransfer ? transferAction : action} className="space-y-5">
          <input type="hidden" name="type" value={type === "TRANSFER" ? "TRANSFER_OUT" : type} />
          <input type="hidden" name="assetMode" value="existing" />
          <input type="hidden" name="currency" value={portfolio.valuation.currency} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {operationChoices.map(([choice, label]) => <Button key={choice} type="button" variant={type === choice ? "primary" : "secondary"} disabled={(choice === "DEPOSIT" || choice === "WITHDRAWAL") && !isCash} onClick={() => { setType(choice); setBasisMethod(choice === "GIFT" ? "ZERO_COST" : "UNKNOWN"); }}>{label}</Button>)}
          </div>
          {(type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash ? <p className="text-sm text-warning">Deposits and withdrawals are only available for CASH assets.</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {type === "INITIAL_BALANCE" ? <Field label="Opening acquisition basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="UNKNOWN">Unknown</option><option value="KNOWN_COST">Known cost</option></select></Field> : null}
            {type === "GIFT" ? <Field label="Gift tracking basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="ZERO_COST">Zero cost</option><option value="FAIR_VALUE">Fair value at receipt</option></select></Field> : null}
            <Field label="Asset"><select name="assetId" required className={inputClassName} value={assetId} onChange={(event) => setAssetId(event.target.value)}>{portfolio.assets.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.symbol})</option>)}</select></Field>
            <Field label={isTransfer ? "From account" : "Account"}><select name={isTransfer ? "fromAccountId" : "accountId"} required className={inputClassName} value={accountId} onChange={(event) => setAccountId(event.target.value)}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
            {isTransfer ? <Field label="To account"><select name="toAccountId" required className={inputClassName} defaultValue={portfolio.accounts.find((account) => account.id !== accountId)?.id ?? ""}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field> : null}
            {isPhysicalGold ? <Field label="Weight (troy oz)"><input name="physicalGoldWeightTroyOunces" required className={inputClassName} inputMode="decimal" placeholder="0.1743" /></Field> : <Field label={type === "DEPOSIT" || type === "WITHDRAWAL" ? "Cash amount" : "Quantity"}><input name="quantity" required className={inputClassName} inputMode="decimal" placeholder="0.25" /></Field>}
            {!isTransfer && !(type === "INITIAL_BALANCE" && basisMethod === "UNKNOWN") && !(type === "GIFT" && basisMethod === "ZERO_COST") ? <Field label={type === "INITIAL_BALANCE" ? "Known unit basis" : type === "GIFT" ? "Fair value per unit" : isPhysicalGold ? "Price per troy ounce" : "Price per unit"}><input name="pricePerUnit" required={type === "BUY" || type === "SELL" || basisMethod === "KNOWN_COST" || basisMethod === "FAIR_VALUE"} className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
            {type === "BUY" || type === "SELL" ? <Field label="Fee (optional)"><input name="fee" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
            <Field label="Date"><input name="executedAt" required type="date" className={inputClassName} defaultValue={today()} /></Field>
          </div>
          {isTransfer ? <p className="text-xs text-muted">Transfers move quantity and cost basis between accounts without creating a sale.</p> : null}
          {type === "DEPOSIT" || type === "WITHDRAWAL" ? <p className="text-xs text-muted">Deposits and withdrawals are external cashflows and do not change Net invested.</p> : null}
          {type === "INITIAL_BALANCE" && basisMethod === "UNKNOWN" ? <p className="text-xs text-muted">Valuation is retained, while gain and return exclude this asset component.</p> : null}
          {type === "GIFT" ? <p className="text-xs text-muted">A gift is an incoming holding, not an external contribution.</p> : null}
          <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} /></Field>
          <ActionMessage state={actionState} />
          <Button type="submit" disabled={pending || !assetId || portfolio.accounts.length === 0 || (isTransfer && portfolio.accounts.length < 2) || ((type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash)} className="w-full sm:w-auto">{pending ? "Saving…" : "Save transaction"}</Button>
        </form>
      )}
    </DialogShell>
  );
}

function TradeForm({ portfolio, onDone, initialSourceAssetId, initialSourceAccountId }: PortfolioClientProps & { onDone: () => void; initialSourceAssetId?: string; initialSourceAccountId?: string }) {
  const [state, action, isPending] = useActionState(createTradeAction, { ok: false, message: "" });
  const [sourceAssetId, setSourceAssetId] = useState(initialSourceAssetId ?? portfolio.assets[0]?.id ?? "");
  const [destinationAssetId, setDestinationAssetId] = useState(portfolio.assets.find((asset) => asset.id !== sourceAssetId)?.id ?? "");
  if (state.ok) return <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onDone} className="w-full">Done</Button></div>;
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source account"><select name="sourceAccountId" required className={inputClassName} defaultValue={initialSourceAccountId ?? portfolio.accounts[0]?.id ?? ""}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
        <Field label="Source asset"><select name="sourceAssetId" required className={inputClassName} value={sourceAssetId} onChange={(event) => { const value = event.target.value; setSourceAssetId(value); if (value === destinationAssetId) setDestinationAssetId(portfolio.assets.find((asset) => asset.id !== value)?.id ?? ""); }}>{portfolio.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>)}</select></Field>
        <Field label="Source quantity"><input name="sourceQuantity" required className={inputClassName} inputMode="decimal" placeholder="500" /></Field>
        <div aria-hidden="true" className="hidden sm:block" />
        <Field label="Destination account"><select name="destinationAccountId" required className={inputClassName} defaultValue={initialSourceAccountId ?? portfolio.accounts[0]?.id ?? ""}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
        <Field label="Destination asset"><select name="destinationAssetId" required className={inputClassName} value={destinationAssetId} onChange={(event) => setDestinationAssetId(event.target.value)}>{portfolio.assets.filter((asset) => asset.id !== sourceAssetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>)}</select></Field>
        <Field label="Destination quantity"><input name="destinationQuantity" required className={inputClassName} inputMode="decimal" placeholder="0.0045" /></Field>
        <Field label={`Fee in ${portfolio.valuation.currency} (optional)`}><input name="fee" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field>
        <Field label="Date"><input name="executedAt" required type="date" className={inputClassName} defaultValue={today()} /></Field>
      </div>
      <p className="text-xs text-muted">The source asset&apos;s proportional acquisition cost is carried to the destination. This is an internal reallocation, not a contribution or withdrawal.</p>
      <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} /></Field>
      <ActionMessage state={state} />
      <Button type="submit" disabled={isPending || portfolio.accounts.length === 0 || portfolio.assets.length < 2}>{isPending ? "Saving…" : "Save trade"}</Button>
    </form>
  );
}

function EditTransactionDialog({ portfolio, transactionId, onClose }: PortfolioClientProps & { transactionId: string; onClose: () => void }) {
  const transaction = portfolio.transactions.find((item) => item.id === transactionId);
  if (!transaction) return null;
  if (transaction.operationKind === "TRANSFER" || transaction.operationKind === "TRADE") {
    return <EditGroupedOperationDialog portfolio={portfolio} transaction={transaction} onClose={onClose} />;
  }
  return <EditStandaloneTransactionDialog transaction={transaction} onClose={onClose} />;
}

function EditStandaloneTransactionDialog({ transaction, onClose }: { transaction: PortfolioReadModel["transactions"][number]; onClose: () => void }) {
  const [state, action, isPending] = useActionState(updateTransactionAction, { ok: false, message: "" });
  const isPhysicalGold = transaction.displayPriceUnit === "troy oz";
  const [basisMethod, setBasisMethod] = useState(transaction.basisMethod ?? "");
  const hasBasisChoice = transaction.type === "INITIAL_BALANCE" || transaction.type === "GIFT";
  const basisHasValue = basisMethod === "KNOWN_COST" || basisMethod === "FAIR_VALUE";

  return (
    <DialogShell title="Edit transaction" description={`${formatType(transaction.type)} · ${transaction.assetName} · ${transaction.accountName}`} onClose={onClose}>
      {state.ok ? (
        <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form action={action} className="space-y-5">
          <input type="hidden" name="id" value={transaction.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            {transaction.type === "INITIAL_BALANCE" ? <Field label="Opening acquisition basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="UNKNOWN">Unknown</option><option value="KNOWN_COST">Known cost</option></select></Field> : null}
            {transaction.type === "GIFT" ? <Field label="Gift tracking basis"><select name="basisMethod" className={inputClassName} value={basisMethod} onChange={(event) => setBasisMethod(event.target.value)}><option value="ZERO_COST">Zero cost</option><option value="FAIR_VALUE">Fair value at receipt</option></select></Field> : null}
            <Field label={isPhysicalGold ? "Weight (troy oz)" : "Quantity"}><input name={isPhysicalGold ? "physicalGoldWeightTroyOunces" : "quantity"} required className={inputClassName} inputMode="decimal" defaultValue={transaction.inputQuantity} /></Field>
            {!hasBasisChoice || basisHasValue ? <Field label={isPhysicalGold ? "Price per troy ounce" : "Price per unit"}><input name="pricePerUnit" className={inputClassName} inputMode="decimal" defaultValue={transaction.displayPricePerUnit ?? ""} placeholder="0.00" /></Field> : null}
            {!hasBasisChoice || basisHasValue ? <Field label="Total amount (alternative)"><input name="totalAmount" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
            {transaction.type !== "GIFT" && basisMethod !== "UNKNOWN" ? <Field label="Fee"><input name="fee" className={inputClassName} inputMode="decimal" defaultValue={transaction.fee ?? ""} placeholder="0.00" /></Field> : null}
            <Field label="Date"><input name="executedAt" required type="date" className={inputClassName} defaultValue={transaction.executedAt.slice(0, 10)} /></Field>
          </div>
          <p className="text-xs text-muted">Asset, account, currency, and operation type stay unchanged. Clear the unit price before entering a total amount instead.</p>
          <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} defaultValue={transaction.note ?? ""} /></Field>
          <ActionMessage state={state} />
          <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
        </form>
      )}
    </DialogShell>
  );
}

function EditGroupedOperationDialog({ portfolio, transaction, onClose }: PortfolioClientProps & { transaction: PortfolioReadModel["transactions"][number]; onClose: () => void }) {
  const isTrade = transaction.operationKind === "TRADE";
  const destination = transaction.destination;
  const [sourceAssetId, setSourceAssetId] = useState(transaction.assetId);
  const isPhysicalTransfer = !isTrade && portfolio.assets.find((asset) => asset.id === sourceAssetId)?.assetType === "PHYSICAL_GOLD";
  const [tradeState, tradeAction, isTradePending] = useActionState(updateTradeAction, { ok: false, message: "" });
  const [transferState, transferAction, isTransferPending] = useActionState(updateTransferAction, { ok: false, message: "" });
  const state = isTrade ? tradeState : transferState;
  const action = isTrade ? tradeAction : transferAction;
  if (!destination) return null;
  return (
    <DialogShell title={`Edit ${isTrade ? "trade" : "transfer"}`} description={`${transaction.symbol} → ${destination.symbol}`} onClose={onClose}>
      {state.ok ? <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div> : (
        <form action={action} className="space-y-5">
          <input type="hidden" name="groupId" value={transaction.groupId ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source account"><select name={isTrade ? "sourceAccountId" : "fromAccountId"} required className={inputClassName} defaultValue={transaction.accountId}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
            <Field label="Source asset"><select name={isTrade ? "sourceAssetId" : "assetId"} required className={inputClassName} value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}>{portfolio.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>)}</select></Field>
            <Field label={isPhysicalTransfer ? "Weight (troy oz)" : "Source quantity"}><input name={isTrade ? "sourceQuantity" : isPhysicalTransfer ? "physicalGoldWeightTroyOunces" : "quantity"} required className={inputClassName} inputMode="decimal" defaultValue={transaction.inputQuantity} /></Field>
            <Field label="Destination account"><select name={isTrade ? "destinationAccountId" : "toAccountId"} required className={inputClassName} defaultValue={destination.accountId}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
            {isTrade ? <Field label="Destination asset"><select name="destinationAssetId" required className={inputClassName} defaultValue={destination.assetId}>{portfolio.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.symbol})</option>)}</select></Field> : null}
            {isTrade ? <Field label="Destination quantity"><input name="destinationQuantity" required className={inputClassName} inputMode="decimal" defaultValue={destination.inputQuantity} /></Field> : null}
            {isTrade ? <Field label={`Fee in ${portfolio.valuation.currency} (optional)`}><input name="fee" className={inputClassName} inputMode="decimal" defaultValue={transaction.fee ?? ""} /></Field> : null}
            <Field label="Date"><input name="executedAt" required type="date" className={inputClassName} defaultValue={transaction.executedAt.slice(0, 10)} /></Field>
          </div>
          <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} defaultValue={transaction.note ?? ""} /></Field>
          <ActionMessage state={state} />
          <Button type="submit" disabled={isTrade ? isTradePending : isTransferPending}>{(isTrade ? isTradePending : isTransferPending) ? "Saving…" : "Save changes"}</Button>
        </form>
      )}
    </DialogShell>
  );
}

function DialogShell({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-background/75 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm md:items-center md:justify-center md:p-4">
      <Card role="dialog" aria-modal="true" aria-labelledby="portfolio-dialog-title" className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full overflow-y-auto overscroll-contain rounded-xl md:max-h-[92vh] md:max-w-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0"><h2 id="portfolio-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>
          <button ref={closeRef} autoFocus={false} type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-primary/50 hover:text-foreground" aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {children}
      </Card>
    </div>
  );
}

function AssetResultButton({ asset, onSelect }: { asset: AssetCatalogResult; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} disabled={asset.isSymbolConflict} className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition hover:border-primary/45 hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50">
      <AssetAvatar asset={asset} size={40} />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{asset.name}</span><span className="block text-xs text-muted">{asset.symbol}{asset.marketCapRank ? ` · Rank #${asset.marketCapRank}` : ""}{asset.exchange ? ` · ${asset.exchange} · ${asset.currency}` : ""}{asset.accessPlan ? ` · ${asset.accessPlan}` : ""}</span></span>
      {asset.existingAssetId ? <Badge tone="success">In portfolio</Badge> : asset.isSymbolConflict ? <Badge tone="warning">Symbol used</Badge> : <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />}
    </button>
  );
}

function AssetAvatar({ asset, size }: { asset: Pick<AssetCatalogResult, "imageUrl" | "symbol" | "name">; size: number }) {
  return asset.imageUrl ? (
    <Image src={asset.imageUrl} alt="" width={size} height={size} className="shrink-0 rounded-full bg-surface-strong" />
  ) : (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{asset.symbol.slice(0, 3)}</span>
  );
}

function HoldingsSection({ portfolio, onAddTransaction }: PortfolioClientProps & { onAddTransaction: (assetId: string, accountId: string) => void }) {
  const [expandedHolding, setExpandedHolding] = useState<string | null>(null);
  if (portfolio.holdings.length === 0) return <EmptyState title="Your portfolio is empty" description="Add an asset and enter the amount you currently own." icon={<Plus className="h-5 w-5" aria-hidden="true" />} />;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-semibold text-foreground">Holdings</h2>
          <p className="mt-1 text-xs text-muted">{portfolio.holdings.length} open {portfolio.holdings.length === 1 ? "position" : "positions"}</p>
        </div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-border bg-surface/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Asset</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Value</th>
              <th className="px-4 py-3 text-right font-medium">Avg net cost</th>
              <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
              <th className="px-4 py-3 text-right font-medium">Weight</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {portfolio.holdings.map((holding) => {
              const holdingId = `${holding.accountId}:${holding.assetId}`;
              const isChartOpen = expandedHolding === holdingId;
              const history = portfolio.assetPriceHistory.find((entry) => entry.assetId === holding.assetId)?.points ?? [];
              return (
              <Fragment key={holdingId}>
              <tr className="transition hover:bg-surface/45">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <AssetAvatar asset={{ imageUrl: holding.imageUrl, symbol: holding.symbol, name: holding.assetName }} size={34} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{holding.assetName}</div>
                      <div className="text-xs text-muted">{holding.symbol} · {holding.assetClass}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{holding.accountName}</td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground">{holding.quantityLabel}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatUnitPriceOrDash(holding.currentPrice, portfolio.valuation.currency, holding.displayPriceUnit)}
                  <p className={cn("mt-1 text-xs", holding.isPriceStale ? "text-warning" : "text-muted")}>{priceStatusText(holding)}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoneyOrUnavailable(holding.currentValue, portfolio.valuation.currency)}</td>
                <td className="px-4 py-3 text-right tabular-nums" title={holding.accountingAverageCost ? `Accounting avg cost: ${formatUnitPriceOrDashText(holding.accountingAverageCost, portfolio.valuation.currency, holding.displayPriceUnit)}` : undefined}>
                  {formatUnitPriceOrDash(holding.averageNetCost, portfolio.valuation.currency, holding.displayPriceUnit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums"><PnlIndicator value={holding.netPnl} format="currency" currency={portfolio.valuation.currency} unavailableLabel="Price unavailable" size="sm" /></td>
                <td className="px-4 py-3 text-right tabular-nums">{holding.portfolioWeight ? `${holding.portfolioWeight}%` : "Unavailable"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => setExpandedHolding(isChartOpen ? null : holdingId)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-primary" title={isChartOpen ? "Hide price chart" : "Show price chart"} aria-label={`${isChartOpen ? "Hide" : "Show"} price chart for ${holding.assetName}`} aria-expanded={isChartOpen}>
                      <ChartNoAxesCombined className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => onAddTransaction(holding.assetId, holding.accountId)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-primary" title="Add transaction" aria-label={`Add transaction for ${holding.assetName}`}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
              {isChartOpen ? (
                <tr>
                  <td colSpan={9} className="bg-surface/30 px-5 py-5">
                    <AssetPriceChart holding={holding} history={history} currency={portfolio.valuation.currency} />
                  </td>
                </tr>
              ) : null}
              </Fragment>
            );})}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-4 md:hidden">
        {portfolio.holdings.map((holding) => {
          const holdingId = `${holding.accountId}:${holding.assetId}`;
          const isChartOpen = expandedHolding === holdingId;
          const history = portfolio.assetPriceHistory.find((entry) => entry.assetId === holding.assetId)?.points ?? [];
          return (
          <div key={`${holdingId}:mobile`} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <AssetAvatar asset={{ imageUrl: holding.imageUrl, symbol: holding.symbol, name: holding.assetName }} size={38} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{holding.assetName}</p>
                  <p className="text-sm text-muted">{holding.symbol} · {holding.assetClass} · {holding.accountName}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setExpandedHolding(isChartOpen ? null : holdingId)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-primary" aria-label={`${isChartOpen ? "Hide" : "Show"} price chart for ${holding.assetName}`} aria-expanded={isChartOpen}>
                  {isChartOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => onAddTransaction(holding.assetId, holding.accountId)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-primary" title="Add transaction" aria-label={`Add transaction for ${holding.assetName}`}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">{holding.quantityLabel}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Info label="Price" value={formatUnitPriceOrDashText(holding.currentPrice, portfolio.valuation.currency, holding.displayPriceUnit)} />
              <Info label="Value" value={formatMoneyOrUnavailableText(holding.currentValue, portfolio.valuation.currency)} />
              <Info label="P&L" value={<PnlIndicator value={holding.netPnl} format="currency" currency={portfolio.valuation.currency} unavailableLabel="Price unavailable" size="sm" variant="text" />} />
              <Info label="Weight" value={holding.portfolioWeight ? `${holding.portfolioWeight}%` : "Unavailable"} />
              <Info label="Avg net cost" value={formatUnitPriceOrDashText(holding.averageNetCost, portfolio.valuation.currency, holding.displayPriceUnit)} />
              <Info label="Price status" value={priceStatusText(holding)} />
            </dl>
            {isChartOpen ? <div className="mt-5 border-t border-border pt-5"><AssetPriceChart holding={holding} history={history} currency={portfolio.valuation.currency} /></div> : null}
          </div>
        );})}
      </div>
    </Card>
  );
}

type AssetPricePoint = PortfolioReadModel["assetPriceHistory"][number]["points"][number];
type AssetPriceChartRow = AssetPricePoint & { numericPrice: number };

function AssetPriceChart({
  holding,
  history,
  currency,
}: {
  holding: PortfolioReadModel["holdings"][number];
  history: AssetPricePoint[];
  currency: string;
}) {
  const [range, setRange] = useState<ChartRange>(defaultChartRange);
  const rows = history.map((point) => ({ ...point, numericPrice: Number(point.price) }));
  const visibleRows = filterChartRowsByRange(rows, range);
  const first = visibleRows[0];
  const last = visibleRows.at(-1);
  const changePercent = first && last && first.numericPrice !== 0
    ? ((last.numericPrice - first.numericPrice) / first.numericPrice) * 100
    : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-semibold text-foreground">{holding.symbol} price</h3>
            {last ? <span className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(last.price, currency)} / {holding.displayPriceUnit}</span> : null}
            {changePercent !== null ? <span className={cn("text-sm font-medium tabular-nums", changePercent > 0 ? "text-success" : changePercent < 0 ? "text-destructive" : "text-muted")}>{formatChartPercent(changePercent)}</span> : null}
          </div>
          <p className="mt-1 text-xs text-muted">Daily market price in {currency} · {chartRangeLabel(range, history[0]?.date ?? null, formatUtcDate)}</p>
        </div>
        <ChartRangeSelector value={range} onChange={setRange} />
      </div>

      {visibleRows.length > 0 ? (
        <div className="mt-4 h-56 w-full min-w-0 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#282d3d" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatChartDate} stroke="#8d93a7" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(value) => compactChartMoney(Number(value), currency)} stroke="#8d93a7" tickLine={false} axisLine={false} width={72} />
              <Tooltip content={({ active, payload }) => <AssetPriceTooltip active={active} row={payload?.[0]?.payload as AssetPriceChartRow | undefined} currency={currency} unit={holding.displayPriceUnit} />} />
              <Line type="monotone" dataKey="numericPrice" name="Price" stroke="#8b5cf6" strokeWidth={2.5} dot={visibleRows.length === 1 ? { r: 4, fill: "#8b5cf6" } : false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <ChartNoAxesCombined className="mx-auto h-7 w-7 text-muted" aria-hidden="true" />
          <p className="mt-3 font-medium text-foreground">Price history is not available yet</p>
          <p className="mx-auto mt-1 max-w-lg text-sm leading-5 text-muted">The daily history worker will add observations automatically. Earlier prices are not estimated.</p>
        </div>
      )}
    </div>
  );
}

function AssetPriceTooltip({ active, row, currency, unit }: { active?: boolean; row?: AssetPriceChartRow; currency: string; unit: "unit" | "troy oz" }) {
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
      <p className="text-xs text-muted">{formatUtcDate(row.date)}</p>
      <p className="mt-1 font-semibold tabular-nums text-foreground">{formatCurrency(row.price, currency)} / {unit}</p>
      <p className={cn("mt-1 text-xs", row.isStale ? "text-warning" : "text-muted")}>{formatType(row.source)}{row.isStale ? " · stale" : ""}</p>
    </div>
  );
}

function AccountsSection({ portfolio, onAddAccount }: PortfolioClientProps & { onAddAccount: () => void }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-semibold text-foreground">Accounts</h2>
          <p className="mt-1 text-xs text-muted">{portfolio.accounts.length} configured</p>
        </div>
        <Button type="button" variant="secondary" onClick={onAddAccount}><Plus className="mr-2 h-4 w-4" />Add account</Button>
      </div>
      <div className="divide-y divide-border">
        {portfolio.accounts.map((account) => (
          <div key={account.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.2fr)] sm:items-center sm:px-5">
            <p className="font-medium text-foreground">{account.name}</p>
            <p className="text-sm text-muted">{formatType(account.type)}</p>
            <p className="text-sm text-muted">{account.custodianName ?? "Unassigned custodian"}{account.description ? ` · ${account.description}` : ""}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TransactionsSection({ portfolio, onAddTransaction, onEditTransaction }: PortfolioClientProps & { onAddTransaction: () => void; onEditTransaction: (transactionId: string) => void }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-semibold text-foreground">Transactions</h2>
          <p className="mt-1 text-xs text-muted">{portfolio.transactions.length} logical {portfolio.transactions.length === 1 ? "operation" : "operations"}</p>
        </div>
        <Button type="button" variant="secondary" onClick={onAddTransaction}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
      </div>
      {portfolio.transactions.length === 0 ? (
        <div className="p-5"><EmptyState title="No transactions yet" description="Record a current balance or your first historical buy." /></div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border bg-surface/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 text-right font-medium">Quantity</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {portfolio.transactions.map((transaction) => (
                  <tr key={transaction.id} className="transition hover:bg-surface/45">
                    <td className="px-4 py-3 text-muted">{formatUtcDate(transaction.executedAt)}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><TransactionTypePill type={transaction.type} />{transaction.basisMethod ? <Badge tone="primary">{formatType(transaction.basisMethod)}</Badge> : null}</div></td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{transaction.assetName}</p>
                      <p className="mt-1 text-xs text-muted">{transaction.symbol}{transaction.destination ? ` → ${transaction.destination.symbol}` : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-muted">{transaction.accountName}{transaction.destination ? ` → ${transaction.destination.accountName}` : ""}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{transaction.quantityLabel}{transaction.destination ? ` → ${transaction.destination.quantityLabel}` : ""}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{transaction.operationKind !== "TRANSACTION" ? (transaction.fee ? `Fee ${formatDecimalCurrency(transaction.fee, transaction.currency)}` : "Internal") : transaction.displayPricePerUnit ? `${formatDecimalCurrency(transaction.displayPricePerUnit, transaction.currency)} / ${transaction.displayPriceUnit}` : "No price"}</td>
                    <td className="px-4 py-3">
                      <TransactionActions transaction={transaction} onEditTransaction={onEditTransaction} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {portfolio.transactions.map((transaction) => (
              <div key={`${transaction.id}:mobile`} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <TransactionTypePill type={transaction.type} />
                      {transaction.basisMethod ? <Badge tone="primary">{formatType(transaction.basisMethod)}</Badge> : null}
                      <span className="text-xs text-muted">{formatUtcDate(transaction.executedAt)}</span>
                    </div>
                    <p className="mt-2 truncate font-medium text-foreground">{transaction.assetName}</p>
                    <p className="mt-1 text-sm text-muted">{transaction.symbol} · {transaction.accountName}{transaction.destination ? ` → ${transaction.destination.symbol} · ${transaction.destination.accountName}` : ""}</p>
                  </div>
                  <TransactionActions transaction={transaction} onEditTransaction={onEditTransaction} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Info label="Quantity" value={`${transaction.quantityLabel}${transaction.destination ? ` → ${transaction.destination.quantityLabel}` : ""}`} />
                  <Info label={transaction.operationKind === "TRADE" ? "Fee" : "Price"} value={transaction.operationKind !== "TRANSACTION" ? (transaction.fee ? formatDecimalCurrency(transaction.fee, transaction.currency) : "Internal") : transaction.displayPricePerUnit ? `${formatDecimalCurrency(transaction.displayPricePerUnit, transaction.currency)} / ${transaction.displayPriceUnit}` : "No price"} />
                </div>
                {transaction.note ? <p className="mt-3 text-sm text-muted">{transaction.note}</p> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TransactionTypePill({ type }: { type: string }) {
  const tone = type === "BUY" || type === "DEPOSIT" || type === "TRANSFER_IN"
    ? "success"
    : type === "SELL" || type === "WITHDRAWAL" || type === "TRANSFER_OUT" || type === "TRADE"
      ? "warning"
      : "primary";
  return <Badge tone={tone}>{formatType(type)}</Badge>;
}

function TransactionActions({ transaction, onEditTransaction }: { transaction: PortfolioReadModel["transactions"][number]; onEditTransaction: (transactionId: string) => void }) {
  const isLegacyTransfer = transaction.operationKind === "TRANSACTION" && (transaction.type === "TRANSFER_IN" || transaction.type === "TRANSFER_OUT");
  const canEdit = !isLegacyTransfer;
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        <Button type="button" variant="ghost" title="Edit transaction" aria-label={`Edit ${transaction.assetName} transaction`} onClick={() => onEditTransaction(transaction.id)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      {!isLegacyTransfer ? <form action={transaction.groupId ? deleteTransactionGroupAction : deleteTransactionAction} onSubmit={(event) => { if (!window.confirm(`Delete this ${transaction.operationKind.toLowerCase()}? Holdings will be recalculated.`)) event.preventDefault(); }}>
        {transaction.groupId ? <input type="hidden" name="groupId" value={transaction.groupId} /> : <input type="hidden" name="id" value={transaction.id} />}
        <Button type="submit" variant="ghost" title="Delete operation" aria-label={`Delete ${transaction.assetName} operation`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
      </form> : null}
    </div>
  );
}

function toCatalogResult(asset: PortfolioReadModel["assets"][number]): AssetCatalogResult {
  return { source: "LOCAL", externalId: null, symbol: asset.symbol, name: asset.name, imageUrl: asset.imageUrl, marketCapRank: null, existingAssetId: asset.id, assetClass: asset.assetClass as AssetCatalogResult["assetClass"], assetType: asset.assetType as AssetCatalogResult["assetType"], currency: asset.currency, quoteProvider: asset.quoteProvider as AssetCatalogResult["quoteProvider"], quoteSymbol: asset.quoteSymbol, quoteMicCode: asset.quoteMicCode, exchange: asset.quoteMicCode, country: null, accessPlan: null, isSymbolConflict: false };
}

function assetResultKey(asset: AssetCatalogResult) {
  return [asset.source, asset.externalId, asset.quoteProvider, asset.quoteSymbol, asset.quoteMicCode, asset.existingAssetId, asset.symbol]
    .filter(Boolean)
    .join(":");
}

function formatQuoteIdentity(asset: AssetCatalogResult) {
  return [asset.quoteSymbol, asset.quoteMicCode, asset.currency].filter(Boolean).join(" · ");
}

function preferredAccountId(accounts: PortfolioReadModel["accounts"], physicalGold: boolean) {
  return (physicalGold ? accounts.find((account) => account.type === "PHYSICAL") : accounts[0])?.id ?? "";
}

function portfolioDataQualityItems(portfolio: PortfolioReadModel): DataQualityItem[] {
  const items: DataQualityItem[] = [];
  if (portfolio.valuation.isPartial) {
    items.push({ message: `Partial valuation: prices are missing for ${portfolio.valuation.missingPriceSymbols.join(", ")}. Portfolio weights and strategy compliance are unavailable.` });
  }
  if (portfolio.valuation.isCostBasisPartial) {
    items.push({ message: `Partial cost basis: net invested, gain, and return exclude ${portfolio.valuation.missingCostBasisSymbols.join(", ")}.` });
  }
  if (portfolio.valuation.hasStalePrices) {
    items.push({ message: "Some prices are stale; current value still uses the latest cached observation." });
  }
  if (portfolio.valuation.warning) {
    items.push({ message: portfolio.valuation.warning });
  }
  return items;
}

function priceStatusText(holding: PortfolioReadModel["holdings"][number]) {
  if (!holding.currentPrice) return "Price unavailable";
  const source = holding.priceSource ? formatType(holding.priceSource) : "Market price";
  return holding.isPriceStale ? `${source} - stale` : source;
}

function moneyTone(value: string | null): "default" | "positive" | "negative" {
  if (!value) return "default";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "default";
  return numeric > 0 ? "positive" : "negative";
}

function formatMoneyWithSign(value: string, currency: string) {
  const numeric = Number(value);
  const sign = Number.isFinite(numeric) && numeric < 0 ? "−" : "+";
  return `${sign}${formatCurrency(value.replace(/^-/, ""), currency)}`;
}

function today() { return new Date().toISOString().slice(0, 10); }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm"><span className="mb-2 block font-medium text-muted">{label}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: ReactNode }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-foreground">{value}</dd></div>; }
function ActionMessage({ state }: { state: { ok: boolean; message: string } }) { return state.message ? <p className={cn("rounded-lg border p-3 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{state.message}</p> : null; }
function formatPercentWithSign(value: string) { const numeric = Number(value); const sign = Number.isFinite(numeric) && numeric < 0 ? "−" : "+"; return `${sign}${value.replace(/^-/, "")}%`; }
function formatType(type: string) {
  if (type === "TRANSFER_OUT") return "Transfer out";
  if (type === "TRANSFER_IN") return "Transfer in";
  return type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}
function formatMoneyOrUnavailable(value: string | null, currency: string) { return value ? <span className="text-foreground">{formatCurrency(value, currency)}</span> : <span className="text-muted">Price unavailable</span>; }
function formatMoneyOrUnavailableText(value: string | null, currency: string) { return value ? formatCurrency(value, currency) : "Price unavailable"; }
function formatUnitPriceOrDash(value: string | null, currency: string, unit: "unit" | "troy oz") { return value ? <span className="text-foreground">{formatCurrency(value, currency)} / {unit}</span> : <span className="text-muted">—</span>; }
function formatUnitPriceOrDashText(value: string | null, currency: string, unit: "unit" | "troy oz") { return value ? `${formatCurrency(value, currency)} / ${unit}` : "—"; }
function formatCurrency(value: string, currency: string) { return formatDecimalCurrency(value, currency); }
function formatTimestamp(value: string | null) { return formatUtcTimestamp(value); }
function formatChartDate(value: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
function formatChartPercent(value: number) { return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`; }
function compactChartMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const inputClassName = "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
const textareaClassName = "min-h-24 w-full resize-y rounded-lg border border-border bg-surface-strong px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
