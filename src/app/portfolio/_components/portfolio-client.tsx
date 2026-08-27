"use client";

import Image from "next/image";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ArrowLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { searchAssetsAction } from "@/features/asset-catalog/actions";
import type { AssetCatalogResult } from "@/features/asset-catalog/types";
import type { AssetCatalogKind } from "@/features/asset-catalog/types";
import {
  createAccountAction,
  createPositionAction,
  createTransferAction,
  createTransactionAction,
  deleteTransactionAction,
  linkAssetQuoteAction,
  updateTransactionAction,
} from "@/features/portfolio/actions";
import type { PortfolioReadModel } from "@/features/portfolio/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
type TransactionOperation = "INITIAL_BALANCE" | "BUY" | "SELL" | "TRANSFER" | "DEPOSIT" | "WITHDRAWAL";

type PortfolioClientProps = { portfolio: PortfolioReadModel };

const accountTypes = ["EXCHANGE", "BROKER", "WALLET", "PHYSICAL", "BANK", "OTHER"] as const;
const assetClasses = ["ETF", "CRYPTO", "GOLD", "CASH", "OTHER"] as const;
const assetTypes = ["CRYPTO", "ETF", "PHYSICAL_GOLD", "TOKENIZED_GOLD", "FIAT", "STABLECOIN", "OTHER"] as const;
const operationChoices: Array<[TransactionOperation, string]> = [
  ["INITIAL_BALANCE", "Current balance"],
  ["BUY", "Buy"],
  ["SELL", "Sell"],
  ["TRANSFER", "Transfer"],
  ["DEPOSIT", "Deposit"],
  ["WITHDRAWAL", "Withdrawal"],
];

export function PortfolioClient({ portfolio }: PortfolioClientProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>("holdings");
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <div className="space-y-4">
      <form id="open-add-asset" action={() => setDialog({ kind: "asset" })} />

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted">Valued portfolio</p>
          <p className="mt-1 break-words text-2xl font-semibold text-foreground">
            {formatCurrency(portfolio.valuation.totalValue, portfolio.valuation.currency)}
          </p>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2 sm:text-right">
          <Metric label="Net invested" value={portfolio.valuation.netInvested ? formatCurrency(portfolio.valuation.netInvested, portfolio.valuation.currency) : "Unavailable"} />
          <Metric label="Simple return" value={portfolio.valuation.simpleReturnPercent ? `${portfolio.valuation.simpleReturnPercent}%` : "Unavailable"} />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {portfolio.valuation.isPartial ? <Badge tone="warning">Partial valuation</Badge> : <Badge tone="success">All prices available</Badge>}
          {portfolio.valuation.isCostBasisPartial ? <Badge tone="warning">Partial cost basis</Badge> : null}
          {portfolio.valuation.hasStalePrices ? <Badge tone="warning">Stale prices</Badge> : null}
          <span className="text-xs text-muted">Last updated {formatTimestamp(portfolio.valuation.lastUpdated)}</span>
        </div>
      </Card>

      {portfolio.valuation.isCostBasisPartial ? <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Net invested, gain, and return exclude: {portfolio.valuation.missingCostBasisSymbols.join(", ")}.</p> : null}

      {portfolio.valuation.warning ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{portfolio.valuation.warning}</p>
      ) : null}

      {portfolio.strategyStatus ? (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted">Portfolio status · {portfolio.strategyStatus.name}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {portfolio.strategyStatus.inRangeCount}/{portfolio.strategyStatus.totalCount} classes in range
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {portfolio.strategyStatus.comparisons.map((comparison) => (
                <Badge key={comparison.assetClass} tone={comparison.status === "IN_RANGE" ? "success" : "warning"}>
                  {comparison.assetClass}: {comparison.status}
                </Badge>
              ))}
            </div>
          </div>
          {portfolio.valuation.isPartial ? <p className="mt-3 text-sm text-warning">Status is partial until all holding prices are available.</p> : null}
        </Card>
      ) : null}

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
        <TransactionsSection portfolio={portfolio} onAddTransaction={() => setDialog({ kind: "asset" })} onEditTransaction={(transactionId) => setDialog({ kind: "edit-transaction", transactionId })} />
      ) : null}

      {dialog?.kind === "asset" ? <AddAssetDialog portfolio={portfolio} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "account" ? <AddAccountDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "transaction" ? (
        <AddTransactionDialog portfolio={portfolio} initialAssetId={dialog.assetId} initialAccountId={dialog.accountId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "edit-transaction" ? (
        <EditTransactionDialog portfolio={portfolio} transactionId={dialog.transactionId} onClose={() => setDialog(null)} />
      ) : null}
    </div>
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
        {operationChoices.map(([value, label]) => (
          <Button key={value} type="button" variant={type === value ? "primary" : "secondary"} disabled={(value === "SELL" || value === "TRANSFER" || value === "WITHDRAWAL") && !asset?.existingAssetId} onClick={() => setType(value)}>{label}</Button>
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
          {!isTransfer ? <Field label={type === "INITIAL_BALANCE" ? "Total invested (optional)" : type === "BUY" || type === "DEPOSIT" ? "Total spent" : "Total received"}>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">{currency === "USD" ? "$" : currency}</span><input name="totalAmount" className={cn(inputClassName, "pl-8")} inputMode="decimal" placeholder="12000.00" /></div>
          </Field> : null}
          <Field label={type === "INITIAL_BALANCE" ? "Balance date" : "Transaction date"}><input name="executedAt" required type="date" className={inputClassName} defaultValue={today()} /></Field>
          {type !== "INITIAL_BALANCE" && !isTransfer ? <Field label={isPhysicalGold ? "Price per troy ounce (alternative)" : "Price per unit (alternative)"}><input name="pricePerUnit" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
          {type !== "INITIAL_BALANCE" && !isTransfer && type !== "DEPOSIT" && type !== "WITHDRAWAL" ? <Field label="Fee (optional)"><input name="fee" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
        </div>
      )}

      {isPhysicalGold ? <p className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-muted">Physical gold uses troy ounces (oz), the precious-metals unit. Values are normalized server-side for deterministic calculations.</p> : null}
      {isTransfer ? <p className="text-xs text-muted">Transfers move quantity and cost basis between accounts without creating a sale.</p> : null}
      {type === "DEPOSIT" || type === "WITHDRAWAL" ? <p className="text-xs text-muted">Cashflows affect invested capital tracking and simple return.</p> : null}
      {type !== "INITIAL_BALANCE" && !isTransfer ? <p className="text-xs text-muted">Enter price per unit or the gross total. If you enter both, they must agree within one cent. Fee is stored separately.</p> : null}
      <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} /></Field>
      <ActionMessage state={actionState} />
      <Button type="submit" disabled={isPending || accounts.length === 0 || (isTransfer && (!asset?.existingAssetId || accounts.length < 2)) || ((type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash)} className="w-full sm:w-auto">
        {isPending ? "Saving…" : "Save transaction"}
      </Button>
    </form>
  );
}

function AddAccountDialog({ onClose }: { onClose: () => void }) {
  const [state, action, isPending] = useActionState(createAccountAction, { ok: false, message: "" });
  return (
    <DialogShell title="Add account" description="Create a place where assets are held." onClose={onClose}>
      {state.ok ? (
        <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form action={action} className="space-y-4">
          <Field label="Name"><input name="name" required className={inputClassName} placeholder="Ledger, bank, wallet…" /></Field>
          <Field label="Type"><select name="type" className={inputClassName} defaultValue="OTHER">{accountTypes.map((type) => <option key={type} value={type}>{formatType(type)}</option>)}</select></Field>
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
            {operationChoices.map(([choice, label]) => <Button key={choice} type="button" variant={type === choice ? "primary" : "secondary"} disabled={(choice === "DEPOSIT" || choice === "WITHDRAWAL") && !isCash} onClick={() => setType(choice)}>{label}</Button>)}
          </div>
          {(type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash ? <p className="text-sm text-warning">Deposits and withdrawals are only available for CASH assets.</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset"><select name="assetId" required className={inputClassName} value={assetId} onChange={(event) => setAssetId(event.target.value)}>{portfolio.assets.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.symbol})</option>)}</select></Field>
            <Field label={isTransfer ? "From account" : "Account"}><select name={isTransfer ? "fromAccountId" : "accountId"} required className={inputClassName} value={accountId} onChange={(event) => setAccountId(event.target.value)}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
            {isTransfer ? <Field label="To account"><select name="toAccountId" required className={inputClassName} defaultValue={portfolio.accounts.find((account) => account.id !== accountId)?.id ?? ""}>{portfolio.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field> : null}
            {isPhysicalGold ? <Field label="Weight (troy oz)"><input name="physicalGoldWeightTroyOunces" required className={inputClassName} inputMode="decimal" placeholder="0.1743" /></Field> : <Field label={type === "DEPOSIT" || type === "WITHDRAWAL" ? "Cash amount" : "Quantity"}><input name="quantity" required className={inputClassName} inputMode="decimal" placeholder="0.25" /></Field>}
            {!isTransfer ? <Field label={isPhysicalGold ? "Price per troy ounce" : "Price per unit"}><input name="pricePerUnit" required={type === "BUY" || type === "SELL"} className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
            {type === "BUY" || type === "SELL" ? <Field label="Fee (optional)"><input name="fee" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field> : null}
            <Field label="Date"><input name="executedAt" required type="date" className={inputClassName} defaultValue={today()} /></Field>
          </div>
          {isTransfer ? <p className="text-xs text-muted">Transfers move quantity and cost basis between accounts without creating a sale.</p> : null}
          {type === "DEPOSIT" || type === "WITHDRAWAL" ? <p className="text-xs text-muted">Cashflows affect invested capital tracking and simple return.</p> : null}
          <Field label="Note (optional)"><textarea name="note" className={textareaClassName} rows={3} /></Field>
          <ActionMessage state={actionState} />
          <Button type="submit" disabled={pending || !assetId || portfolio.accounts.length === 0 || (isTransfer && portfolio.accounts.length < 2) || ((type === "DEPOSIT" || type === "WITHDRAWAL") && !isCash)} className="w-full sm:w-auto">{pending ? "Saving…" : "Save transaction"}</Button>
        </form>
      )}
    </DialogShell>
  );
}

function EditTransactionDialog({ portfolio, transactionId, onClose }: PortfolioClientProps & { transactionId: string; onClose: () => void }) {
  const transaction = portfolio.transactions.find((item) => item.id === transactionId);
  const [state, action, isPending] = useActionState(updateTransactionAction, { ok: false, message: "" });
  if (!transaction) return null;
  const isPhysicalGold = transaction.displayPriceUnit === "troy oz";

  return (
    <DialogShell title="Edit transaction" description={`${formatType(transaction.type)} · ${transaction.assetName} · ${transaction.accountName}`} onClose={onClose}>
      {state.ok ? (
        <div className="space-y-4"><ActionMessage state={state} /><Button type="button" onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form action={action} className="space-y-5">
          <input type="hidden" name="id" value={transaction.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isPhysicalGold ? "Weight (troy oz)" : "Quantity"}><input name={isPhysicalGold ? "physicalGoldWeightTroyOunces" : "quantity"} required className={inputClassName} inputMode="decimal" defaultValue={transaction.inputQuantity} /></Field>
            <Field label={isPhysicalGold ? "Price per troy ounce" : "Price per unit"}><input name="pricePerUnit" className={inputClassName} inputMode="decimal" defaultValue={transaction.displayPricePerUnit ?? ""} placeholder="0.00" /></Field>
            <Field label="Total amount (alternative)"><input name="totalAmount" className={inputClassName} inputMode="decimal" placeholder="0.00" /></Field>
            <Field label="Fee"><input name="fee" className={inputClassName} inputMode="decimal" defaultValue={transaction.fee ?? ""} placeholder="0.00" /></Field>
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
  if (portfolio.holdings.length === 0) return <EmptyState title="Your portfolio is empty" description="Add an asset and enter the amount you currently own." icon={<Plus className="h-5 w-5" aria-hidden="true" />} />;
  return (
    <Card>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr className="border-b border-border"><th className="py-3 pr-4">Asset</th><th className="py-3 pr-4">Account</th><th className="py-3 pr-4">Quantity</th><th className="py-3 pr-4">Current value</th><th className="py-3 pr-4">Avg price</th><th className="py-3 pr-4">P&amp;L</th><th className="py-3 pr-4">Class</th><th className="py-3 pr-4">Weight</th><th className="py-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{portfolio.holdings.map((holding) => <tr key={`${holding.accountId}:${holding.assetId}`} className="border-b border-border/70 last:border-0"><td className="py-4 pr-4"><div className="flex items-center gap-3"><AssetAvatar asset={{ imageUrl: holding.imageUrl, symbol: holding.symbol, name: holding.assetName }} size={34} /><div><div className="font-medium text-foreground">{holding.assetName}</div><div className="text-xs text-muted">{holding.symbol}</div></div></div></td><td className="py-4 pr-4 text-muted">{holding.accountName}</td><td className="py-4 pr-4 text-foreground">{holding.quantityLabel}</td><td className="py-4 pr-4"><div className="flex items-center gap-2">{formatMoneyOrUnavailable(holding.currentValue, portfolio.valuation.currency)}<PriceBadge holding={holding} /></div></td><td className="py-4 pr-4">{formatUnitPriceOrDash(holding.averageAcquisitionPrice, portfolio.valuation.currency, holding.displayPriceUnit)}</td><td className="py-4 pr-4">{formatMoneyOrUnavailable(holding.pnl, portfolio.valuation.currency)}</td><td className="py-4 pr-4"><Badge tone="primary">{holding.assetClass}</Badge></td><td className="py-4 pr-4">{holding.portfolioWeight ? `${holding.portfolioWeight}%` : "Price unavailable"}</td><td className="py-4"><button type="button" onClick={() => onAddTransaction(holding.assetId, holding.accountId)} className="min-h-11 whitespace-nowrap rounded-lg px-3 text-sm text-primary hover:bg-primary/10">Add transaction</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">{portfolio.holdings.map((holding) => <div key={`${holding.accountId}:${holding.assetId}:mobile`} className="rounded-lg border border-border bg-surface p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><AssetAvatar asset={{ imageUrl: holding.imageUrl, symbol: holding.symbol, name: holding.assetName }} size={38} /><div className="min-w-0"><p className="truncate font-medium text-foreground">{holding.assetName}</p><p className="text-sm text-muted">{holding.symbol} · {holding.accountName}</p></div></div><Badge tone="primary">{holding.assetClass}</Badge></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><Info label="Quantity" value={holding.quantityLabel} /><Info label="Value" value={formatMoneyOrUnavailableText(holding.currentValue, portfolio.valuation.currency)} /><Info label="Avg price" value={formatUnitPriceOrDashText(holding.averageAcquisitionPrice, portfolio.valuation.currency, holding.displayPriceUnit)} /><Info label="P&L" value={formatMoneyOrUnavailableText(holding.pnl, portfolio.valuation.currency)} /><Info label="Price status" value={holding.currentPrice ? `${holding.priceSource}${holding.isPriceStale ? " · stale" : ""}` : "Unavailable"} /></dl><Button type="button" variant="ghost" onClick={() => onAddTransaction(holding.assetId, holding.accountId)} className="mt-3 w-full"><Plus className="mr-2 h-4 w-4" />Add transaction</Button></div>)}</div>
    </Card>
  );
}

function AccountsSection({ portfolio, onAddAccount }: PortfolioClientProps & { onAddAccount: () => void }) {
  return <Card><div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold text-foreground">Accounts</h2><Button type="button" variant="secondary" onClick={onAddAccount}><Plus className="mr-2 h-4 w-4" />Add account</Button></div><div className="grid gap-3 md:grid-cols-3">{portfolio.accounts.map((account) => <div key={account.id} className="rounded-lg border border-border bg-surface p-4"><p className="font-medium text-foreground">{account.name}</p><p className="mt-1 text-sm text-muted">{formatType(account.type)}</p>{account.description ? <p className="mt-3 text-sm text-muted">{account.description}</p> : null}</div>)}</div></Card>;
}

function TransactionsSection({ portfolio, onAddTransaction, onEditTransaction }: PortfolioClientProps & { onAddTransaction: () => void; onEditTransaction: (transactionId: string) => void }) {
  return <Card><div className="mb-4 flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold text-foreground">Transactions</h2><p className="mt-1 text-sm text-muted">Enter older trades first so historical balance checks remain clear.</p></div><Button type="button" variant="secondary" onClick={onAddTransaction}><Plus className="mr-2 h-4 w-4" />Add transaction</Button></div>{portfolio.transactions.length === 0 ? <EmptyState title="No transactions yet" description="Record a current balance or your first historical buy." /> : <div className="space-y-3">{portfolio.transactions.map((transaction) => <div key={transaction.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge>{formatType(transaction.type)}</Badge><p className="font-medium text-foreground">{transaction.assetName}</p><p className="text-sm text-muted">{transaction.symbol} · {transaction.accountName}</p></div><p className="mt-2 text-sm text-muted">{transaction.quantityLabel} · {transaction.displayPricePerUnit ? `${formatDecimalCurrency(transaction.displayPricePerUnit, transaction.currency)} / ${transaction.displayPriceUnit}` : "No acquisition price"} · {formatUtcDate(transaction.executedAt)}</p>{transaction.note ? <p className="mt-2 text-sm text-muted">{transaction.note}</p> : null}</div><div className="flex items-center gap-2">{transaction.type !== "TRANSFER_IN" && transaction.type !== "TRANSFER_OUT" ? <Button type="button" variant="ghost" title="Edit transaction" aria-label="Edit transaction" onClick={() => onEditTransaction(transaction.id)}><Pencil className="h-4 w-4" /></Button> : null}<form action={deleteTransactionAction} onSubmit={(event) => { if (!window.confirm("Delete this transaction? Holdings will be recalculated.")) event.preventDefault(); }}><input type="hidden" name="id" value={transaction.id} /><Button type="submit" variant="ghost"><Trash2 className="mr-2 h-4 w-4" />Delete</Button></form></div></div>)}</div>}</Card>;
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

function today() { return new Date().toISOString().slice(0, 10); }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm"><span className="mb-2 block font-medium text-muted">{label}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-foreground">{value}</dd></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-semibold text-foreground">{value}</p></div>; }
function ActionMessage({ state }: { state: { ok: boolean; message: string } }) { return state.message ? <p className={cn("rounded-lg border p-3 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{state.message}</p> : null; }
function PriceBadge({ holding }: { holding: PortfolioReadModel["holdings"][number] }) { if (!holding.currentPrice) return <Badge>Unavailable</Badge>; if (holding.isPriceStale) return <Badge tone="warning">Stale</Badge>; return <Badge tone={holding.priceSource === "MANUAL" ? "primary" : "success"}>{holding.priceSource}</Badge>; }
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

const inputClassName = "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
const textareaClassName = "min-h-24 w-full resize-y rounded-lg border border-border bg-surface-strong px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
