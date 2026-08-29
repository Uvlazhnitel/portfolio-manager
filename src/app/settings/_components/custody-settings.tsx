"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { assignAccountCustodianAction, saveCustodianAction } from "@/features/custody/actions";
import type { getCustodySettingsReadModel } from "@/features/custody/read-model";
import { cn } from "@/lib/utils";

type Model = Awaited<ReturnType<typeof getCustodySettingsReadModel>>;
const categories = ["EXCHANGE", "BROKER", "SELF_CUSTODY", "PHYSICAL", "BANK", "OTHER"];
const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

export function CustodySettings({ model }: { model: Model }) {
  return <Card><div><h2 className="text-lg font-semibold">Custody and counterparties</h2><p className="mt-1 text-sm text-muted">Group accounts that share the same counterparty risk.</p></div><div className="mt-6 grid gap-6 xl:grid-cols-2"><div className="space-y-4"><CustodianForm />{model.custodians.map((item) => <CustodianForm key={item.id} item={item} />)}</div><div><h3 className="font-medium">Account assignments</h3><div className="mt-3 divide-y divide-border rounded-lg border border-border">{model.accounts.map((account) => <AccountAssignment key={account.id} account={account} custodians={model.custodians} />)}</div></div></div></Card>;
}

function CustodianForm({ item }: { item?: Model["custodians"][number] }) {
  const [state, action, pending] = useActionState(saveCustodianAction, { ok: false, message: "" });
  return <form action={action} className="rounded-lg border border-border bg-surface p-4"><input type="hidden" name="id" value={item?.id ?? ""} /><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-muted">Name<input name="name" required defaultValue={item?.name ?? ""} className={cn(input,"mt-1")} placeholder="Bybit" /></label><label className="text-sm text-muted">Category<select name="category" defaultValue={item?.category ?? "OTHER"} className={cn(input,"mt-1")}>{categories.map((category) => <option key={category}>{category.replaceAll("_"," ")}</option>)}</select></label></div><label className="mt-3 block text-sm text-muted">Description<textarea name="description" defaultValue={item?.description ?? ""} className={cn(input,"mt-1")} rows={2} /></label>{item ? <p className="mt-2 text-xs text-muted">{item.accounts.length ? item.accounts.map((account) => account.name).join(", ") : "No linked accounts"}</p> : null}{state.message ? <p className={cn("mt-2 text-sm",state.ok?"text-success":"text-destructive")}>{state.message}</p>:null}<Button type="submit" variant="secondary" disabled={pending} className="mt-3">{pending?"Saving…":item?"Save custodian":"Add custodian"}</Button></form>;
}

function AccountAssignment({ account, custodians }: { account: Model["accounts"][number]; custodians: Model["custodians"] }) {
  const [state, action, pending] = useActionState(assignAccountCustodianAction, { ok: false, message: "" });
  return <form action={action} className="p-4"><input type="hidden" name="accountId" value={account.id}/><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium">{account.name}</p><p className="text-xs text-muted">{account.type}</p></div><select name="custodianId" defaultValue={account.custodianId ?? ""} className={input}><option value="">Unassigned</option>{custodians.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="submit" variant="secondary" disabled={pending}>{pending?"Saving…":"Assign"}</Button></div>{state.message?<p className={cn("mt-2 text-xs",state.ok?"text-success":"text-destructive")}>{state.message}</p>:null}</form>;
}
