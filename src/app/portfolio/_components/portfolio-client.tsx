"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { createAccountAction, createTransactionAction, deleteTransactionAction } from "@/features/portfolio/actions";
import type { PortfolioReadModel } from "@/features/portfolio/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { formatDecimalCurrency } from "@/lib/format/decimal";
import { formatUtcDate, formatUtcTimestamp } from "@/lib/format/date";

type PortfolioTab = "holdings" | "accounts" | "transactions";
type AddMode = "transaction" | "account";
type AssetMode = "existing" | "new";

type PortfolioClientProps = {
  portfolio: PortfolioReadModel;
};

const transactionChoices = [
  "INITIAL_BALANCE",
  "BUY",
  "SELL",
] as const;

const disabledTransactionChoices = [
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER",
] as const;

const accountTypes = ["EXCHANGE", "BROKER", "WALLET", "PHYSICAL", "BANK", "OTHER"] as const;
const assetClasses = ["ETF", "CRYPTO", "GOLD", "CASH", "OTHER"] as const;
const assetTypes = ["CRYPTO", "ETF", "PHYSICAL_GOLD", "TOKENIZED_GOLD", "FIAT", "STABLECOIN", "OTHER"] as const;

export function PortfolioClient({ portfolio }: PortfolioClientProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>("holdings");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("transaction");
  const [transactionType, setTransactionType] = useState("INITIAL_BALANCE");
  const [assetMode, setAssetMode] = useState<AssetMode>("existing");
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const [selectedAssetId, setSelectedAssetId] = useState(portfolio.assets[0]?.id ?? "");
  const [transactionState, transactionAction, isTransactionPending] = useActionState(createTransactionAction, {
    ok: false,
    message: "",
  });
  const [accountState, accountAction, isAccountPending] = useActionState(createAccountAction, {
    ok: false,
    message: "",
  });
  const selectedAsset = useMemo(
    () => portfolio.assets.find((asset) => asset.id === selectedAssetId),
    [portfolio.assets, selectedAssetId],
  );
  const isPhysicalGold = assetMode === "existing" && selectedAsset?.assetType === "PHYSICAL_GOLD";

  useEffect(() => {
    if (!isAddOpen) return;
    closeDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAddOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isAddOpen]);

  return (
    <div className="space-y-4">
      <form id="open-add-transaction" action={() => setIsAddOpen(true)} />

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted">Valued portfolio</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {formatCurrency(portfolio.valuation.totalValue)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {portfolio.valuation.isPartial ? (
            <Badge tone="warning">Partial valuation</Badge>
          ) : (
            <Badge tone="success">All prices available</Badge>
          )}
          {portfolio.valuation.hasStalePrices ? <Badge tone="warning">Stale prices</Badge> : null}
          <span className="text-xs text-muted">Last updated {formatTimestamp(portfolio.valuation.lastUpdated)}</span>
        </div>
      </Card>

      {portfolio.valuation.warning ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {portfolio.valuation.warning}
        </p>
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
                <Badge
                  key={comparison.assetClass}
                  tone={comparison.status === "IN_RANGE" ? "success" : "warning"}
                  title={`${Number(comparison.currentPercent).toFixed(1)}% current · ${Number(comparison.targetPercent).toFixed(1)}% target`}
                >
                  {comparison.assetClass}: {comparison.status}
                </Badge>
              ))}
            </div>
          </div>
          {portfolio.valuation.isPartial ? (
            <p className="mt-3 text-sm text-warning">Status is partial until all holding prices are available.</p>
          ) : null}
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
              activeTab === tab
                ? "border-primary/35 bg-primary/15 text-foreground"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "holdings" ? <HoldingsSection portfolio={portfolio} /> : null}
      {activeTab === "accounts" ? (
        <AccountsSection
          portfolio={portfolio}
          onAddAccount={() => {
            setAddMode("account");
            setIsAddOpen(true);
          }}
        />
      ) : null}
      {activeTab === "transactions" ? <TransactionsSection portfolio={portfolio} /> : null}

      {isAddOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-background/75 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm md:items-center md:justify-center md:p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="portfolio-add-dialog-title"
            className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full overflow-y-auto overscroll-contain rounded-xl md:max-h-[92vh] md:max-w-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="portfolio-add-dialog-title" className="text-lg font-semibold text-foreground">
                  {addMode === "account" ? "Add account" : "Add transaction"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {addMode === "account"
                    ? "Create a new place where assets can be held."
                    : "Holdings are recalculated from saved transactions."}
                </p>
              </div>
              <button
                ref={closeDialogRef}
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-primary/50 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mb-5 flex gap-2">
              <Button type="button" variant={addMode === "transaction" ? "primary" : "secondary"} onClick={() => setAddMode("transaction")}>
                Transaction
              </Button>
              <Button type="button" variant={addMode === "account" ? "primary" : "secondary"} onClick={() => setAddMode("account")}>
                Account
              </Button>
            </div>

            {addMode === "account" ? (
              <form action={accountAction} className="space-y-4">
                <Field label="Name">
                  <input name="name" required className={inputClassName} placeholder="Ledger, bank, wallet..." />
                </Field>
                <Field label="Type">
                  <select name="type" className={inputClassName} defaultValue="OTHER">
                    {accountTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description">
                  <textarea name="description" className={inputClassName} rows={3} />
                </Field>
                <ActionMessage state={accountState} />
                <Button type="submit" disabled={isAccountPending}>
                  {isAccountPending ? "Saving..." : "Create account"}
                </Button>
              </form>
            ) : (
              <form action={transactionAction} className="space-y-5">
                <input type="hidden" name="type" value={transactionType} />
                <input type="hidden" name="assetMode" value={assetMode} />
                <div className="grid gap-2 sm:grid-cols-3">
                  {transactionChoices.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={transactionType === choice ? "primary" : "secondary"}
                      onClick={() => setTransactionType(choice)}
                    >
                      {formatType(choice)}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {disabledTransactionChoices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      disabled
                      className="h-11 rounded-lg border border-border bg-surface text-sm font-medium text-muted/60"
                    >
                      {formatType(choice)}
                    </button>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Account">
                    <select name="accountId" required className={inputClassName}>
                      {portfolio.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Asset">
                    <select
                      name="assetId"
                      required={assetMode === "existing"}
                      disabled={assetMode === "new"}
                      value={selectedAssetId}
                      onChange={(event) => setSelectedAssetId(event.target.value)}
                      className={inputClassName}
                    >
                      {portfolio.assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name} ({asset.symbol})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant={assetMode === "existing" ? "primary" : "secondary"} onClick={() => setAssetMode("existing")}>
                    Existing asset
                  </Button>
                  <Button type="button" variant={assetMode === "new" ? "primary" : "secondary"} onClick={() => setAssetMode("new")}>
                    Create new asset
                  </Button>
                </div>

                {assetMode === "new" ? <NewAssetFields /> : null}

                {isPhysicalGold ? (
                  <div className="rounded-lg border border-primary/25 bg-primary/10 p-4">
                    <p className="text-sm font-medium text-primary">Physical Gold</p>
                    <p className="mt-1 text-sm text-muted">Quantity is stored in grams. Example: 100 g.</p>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  {isPhysicalGold ? (
                    <>
                      <Field label="Weight grams">
                        <input name="physicalGoldWeightGrams" required className={inputClassName} inputMode="decimal" placeholder="100" />
                      </Field>
                      {transactionType === "SELL" ? (
                        <Field label="Price per gram">
                          <input name="pricePerUnit" required className={inputClassName} inputMode="decimal" placeholder="62.50" />
                        </Field>
                      ) : (
                        <Field label="Total purchase cost">
                          <input name="totalPurchaseCost" className={inputClassName} inputMode="decimal" placeholder="6250" />
                        </Field>
                      )}
                    </>
                  ) : (
                    <>
                      <Field label="Quantity">
                        <input name="quantity" required className={inputClassName} inputMode="decimal" placeholder="0.5" />
                      </Field>
                      <Field label={transactionType === "INITIAL_BALANCE" ? "Average acquisition price" : "Price per unit"}>
                        <input
                          name="pricePerUnit"
                          required={transactionType !== "INITIAL_BALANCE"}
                          className={inputClassName}
                          inputMode="decimal"
                          placeholder="Optional"
                        />
                      </Field>
                    </>
                  )}
                  <Field label="Fee">
                    <input name="fee" className={inputClassName} inputMode="decimal" placeholder="Optional" />
                  </Field>
                  <Field label="Currency">
                    <input name="currency" className={inputClassName} defaultValue="EUR" />
                  </Field>
                  <Field label="Date">
                    <input name="executedAt" required type="date" className={inputClassName} defaultValue={new Date().toISOString().slice(0, 10)} />
                  </Field>
                </div>

                {transactionType === "SELL" ? (
                  <label className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-muted">
                    <input name="allowOversell" type="checkbox" className="mt-1" />
                    <span>Allow selling more than the current quantity in this account.</span>
                  </label>
                ) : null}

                <Field label="Note">
                  <textarea name="note" className={inputClassName} rows={3} />
                </Field>

                <ActionMessage state={transactionState} />
                <Button type="submit" disabled={isTransactionPending || portfolio.accounts.length === 0 || portfolio.assets.length === 0}>
                  {isTransactionPending ? "Saving..." : "Save transaction"}
                </Button>
              </form>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function HoldingsSection({ portfolio }: PortfolioClientProps) {
  if (portfolio.holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        description="Add an initial balance or buy transaction to start tracking positions."
        icon={<Plus className="h-5 w-5" aria-hidden="true" />}
      />
    );
  }

  return (
    <Card>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr className="border-b border-border">
              <th className="py-3 pr-4">Asset</th>
              <th className="py-3 pr-4">Account</th>
              <th className="py-3 pr-4">Quantity</th>
              <th className="py-3 pr-4">Current value</th>
              <th className="py-3 pr-4">Avg price</th>
              <th className="py-3 pr-4">P&L</th>
              <th className="py-3 pr-4">Class</th>
              <th className="py-3">Weight</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((holding) => (
              <tr key={`${holding.accountId}:${holding.assetId}`} className="border-b border-border/70 last:border-0">
                <td className="py-4 pr-4">
                  <div className="font-medium text-foreground">{holding.assetName}</div>
                  <div className="text-xs text-muted">{holding.symbol}</div>
                </td>
                <td className="py-4 pr-4 text-muted">{holding.accountName}</td>
                <td className="py-4 pr-4 text-foreground">{holding.quantityLabel}</td>
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2">
                    {formatMoneyOrUnavailable(holding.currentValue)}
                    <PriceBadge holding={holding} />
                  </div>
                </td>
                <td className="py-4 pr-4">{formatMoneyOrDash(holding.averageAcquisitionPrice)}</td>
                <td className="py-4 pr-4">{formatMoneyOrUnavailable(holding.pnl)}</td>
                <td className="py-4 pr-4">
                  <Badge tone="primary">{holding.assetClass}</Badge>
                </td>
                <td className="py-4">{holding.portfolioWeight ? `${holding.portfolioWeight}%` : "Price unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {portfolio.holdings.map((holding) => (
          <div key={`${holding.accountId}:${holding.assetId}:mobile`} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{holding.assetName}</p>
                <p className="text-sm text-muted">{holding.symbol} · {holding.accountName}</p>
              </div>
              <Badge tone="primary">{holding.assetClass}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Info label="Quantity" value={holding.quantityLabel} />
              <Info label="Value" value={formatMoneyOrUnavailableText(holding.currentValue)} />
              <Info label="Avg price" value={formatMoneyOrDashText(holding.averageAcquisitionPrice)} />
              <Info label="P&L" value={formatMoneyOrUnavailableText(holding.pnl)} />
              <Info
                label="Price status"
                value={holding.currentPrice ? `${holding.priceSource}${holding.isPriceStale ? " · stale" : ""}` : "Unavailable"}
              />
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AccountsSection({ portfolio, onAddAccount }: PortfolioClientProps & { onAddAccount: () => void }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Accounts</h2>
        <Button type="button" variant="secondary" onClick={onAddAccount}>Add account</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {portfolio.accounts.map((account) => (
          <div key={account.id} className="rounded-lg border border-border bg-surface p-4">
            <p className="font-medium text-foreground">{account.name}</p>
            <p className="mt-1 text-sm text-muted">{account.type}</p>
            {account.description ? <p className="mt-3 text-sm text-muted">{account.description}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TransactionsSection({ portfolio }: PortfolioClientProps) {
  if (portfolio.transactions.length === 0) {
    return <EmptyState title="No transactions yet" description="Transactions are the source of truth for holdings." />;
  }

  return (
    <Card>
      <div className="space-y-3">
        {portfolio.transactions.map((transaction) => (
          <div key={transaction.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{formatType(transaction.type)}</Badge>
                <p className="font-medium text-foreground">{transaction.assetName}</p>
                <p className="text-sm text-muted">{transaction.symbol} · {transaction.accountName}</p>
              </div>
              <p className="mt-2 text-sm text-muted">
                {transaction.quantity} · {transaction.pricePerUnit ? `€${transaction.pricePerUnit}` : "No price"} ·{" "}
                {formatUtcDate(transaction.executedAt)}
              </p>
              {transaction.note ? <p className="mt-2 text-sm text-muted">{transaction.note}</p> : null}
            </div>
            <form
              action={deleteTransactionAction}
              onSubmit={(event) => {
                if (!window.confirm("Delete this transaction? Holdings will be recalculated.")) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={transaction.id} />
              <Button type="submit" variant="ghost">
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </form>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NewAssetFields() {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
      <Field label="New asset symbol">
        <input name="newAssetSymbol" className={inputClassName} placeholder="AAPL" />
      </Field>
      <Field label="New asset name">
        <input name="newAssetName" className={inputClassName} placeholder="Apple Inc." />
      </Field>
      <Field label="Asset class">
        <select name="newAssetClass" className={inputClassName} defaultValue="OTHER">
          {assetClasses.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Asset type">
        <select name="newAssetType" className={inputClassName} defaultValue="OTHER">
          {assetTypes.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Currency">
        <input name="newAssetCurrency" className={inputClassName} defaultValue="EUR" />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-foreground">{value}</dd>
    </div>
  );
}

function ActionMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) {
    return null;
  }

  return (
    <p className={cn("rounded-lg border p-3 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>
      {state.message}
    </p>
  );
}

function PriceBadge({ holding }: { holding: PortfolioReadModel["holdings"][number] }) {
  if (!holding.currentPrice) {
    return <Badge>Unavailable</Badge>;
  }

  if (holding.isPriceStale) {
    return <Badge tone="warning">Stale</Badge>;
  }

  return <Badge tone={holding.priceSource === "MANUAL" ? "primary" : "success"}>{holding.priceSource}</Badge>;
}

function formatType(type: string) {
  return type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatMoneyOrUnavailable(value: string | null) {
  return value ? <span className="text-foreground">{formatCurrency(value)}</span> : <span className="text-muted">Price unavailable</span>;
}

function formatMoneyOrUnavailableText(value: string | null) {
  return value ? formatCurrency(value) : "Price unavailable";
}

function formatMoneyOrDash(value: string | null) {
  return value ? <span className="text-foreground">{formatCurrency(value)}</span> : <span className="text-muted">—</span>;
}

function formatMoneyOrDashText(value: string | null) {
  return value ? formatCurrency(value) : "—";
}

function formatCurrency(value: string) {
  return formatDecimalCurrency(value, "EUR");
}

function formatTimestamp(value: string | null) {
  return formatUtcTimestamp(value);
}

const inputClassName =
  "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
