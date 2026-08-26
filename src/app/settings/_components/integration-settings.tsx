"use client";

import { useActionState } from "react";
import { CheckCircle2, KeyRound, PlugZap, ShieldAlert, Trash2 } from "lucide-react";
import {
  deleteIntegrationApiKeyAction,
  saveIntegrationSettingAction,
  testIntegrationConnectionAction,
} from "@/features/integrations/actions";
import type { IntegrationSettingsReadModel } from "@/features/integrations/read-model";
import { IntegrationProvider, type IntegrationProvider as IntegrationProviderName } from "@/lib/domain/enums";
import { formatUtcTimestamp } from "@/lib/format/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Integration = IntegrationSettingsReadModel["integrations"][number];

export function IntegrationSettings({ model }: { model: IntegrationSettingsReadModel }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/8 p-4">
        {model.encryptionAvailable
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />}
        <div>
          <p className="font-medium text-foreground">
            {model.encryptionAvailable ? "Encrypted credential storage is ready" : "Credential storage needs server setup"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {model.encryptionAvailable
              ? "API keys are encrypted before PostgreSQL storage and are never returned to the browser."
              : "Configure a base64-encoded 32-byte APP_ENCRYPTION_KEY on the server before saving API keys here."}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        {model.integrations.map((integration) => (
          <IntegrationCard key={integration.provider} integration={integration} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const [saveState, saveAction, isSaving] = useActionState(saveIntegrationSettingAction, { ok: false, message: "" });
  const [testState, testAction, isTesting] = useActionState(testIntegrationConnectionAction, { ok: false, message: "" });
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteIntegrationApiKeyAction, { ok: false, message: "" });
  const isOpenAI = integration.provider === IntegrationProvider.OPENAI;
  const hasStoredKey = integration.source === "DATABASE" || integration.source === "UNAVAILABLE";

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            {isOpenAI ? <PlugZap className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">{providerName(integration.provider)}</h2>
            <p className="truncate text-sm text-muted">{providerDescription(integration.provider)}</p>
          </div>
        </div>
        <Badge tone={sourceTone(integration.source)}>{sourceLabel(integration.source)}</Badge>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">API key</span>
          <span className="font-mono text-foreground">
            {integration.suffix ? `••••${integration.suffix}` : integration.isConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        {isOpenAI ? (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-muted">Model</span>
            <span className="truncate font-mono text-foreground">{integration.model}</span>
          </div>
        ) : null}
        {integration.updatedAt ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">Updated {formatUtcTimestamp(integration.updatedAt)}</p>
        ) : null}
        {integration.error ? <p className="mt-3 text-sm text-destructive">{integration.error}</p> : null}
      </div>

      <form action={saveAction} className="mt-5 space-y-4">
        <input type="hidden" name="provider" value={integration.provider} />
        <label className="block text-sm">
          <span className="mb-2 block font-medium text-muted">{hasStoredKey ? "Replace API key" : "API key"}</span>
          <input
            type="password"
            name="apiKey"
            autoComplete="off"
            spellCheck={false}
            className={inputClassName}
            placeholder={isOpenAI && integration.isConfigured ? "Leave blank to keep current key" : hasStoredKey ? "Paste replacement key" : "Paste provider key"}
            required={!isOpenAI}
          />
        </label>
        {isOpenAI ? (
          <label className="block text-sm">
            <span className="mb-2 block font-medium text-muted">Model</span>
            <input name="model" defaultValue={integration.model ?? "gpt-5-mini"} className={inputClassName} required />
          </label>
        ) : null}

        <ActionMessage state={saveState} />
        <Button type="submit" disabled={isSaving} className="w-full sm:w-auto">
          {isSaving ? "Saving…" : hasStoredKey ? "Replace settings" : "Save settings"}
        </Button>
      </form>

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
        <form action={testAction} className="flex-1">
          <input type="hidden" name="provider" value={integration.provider} />
          <Button type="submit" variant="secondary" disabled={isTesting} className="w-full">
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
        </form>
        {hasStoredKey ? (
          <form
            action={deleteAction}
            className="flex-1"
            onSubmit={(event) => {
              if (!window.confirm(`Delete the stored ${providerName(integration.provider)} API key?`)) event.preventDefault();
            }}
          >
            <input type="hidden" name="provider" value={integration.provider} />
            <Button type="submit" variant="ghost" disabled={isDeleting} className="w-full text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" /> {isDeleting ? "Deleting…" : "Delete stored key"}
            </Button>
          </form>
        ) : null}
      </div>
      <ActionMessage state={testState.message ? testState : deleteState} className="mt-3" />
    </Card>
  );
}

function ActionMessage({ state, className }: { state: { ok: boolean; message: string }; className?: string }) {
  if (!state.message) return null;
  return (
    <p className={cn(
      "rounded-lg border p-3 text-sm",
      state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
      className,
    )}>{state.message}</p>
  );
}

function providerDescription(provider: IntegrationProviderName) {
  if (provider === IntegrationProvider.OPENAI) return "Portfolio decision-support assistant";
  if (provider === IntegrationProvider.COINGECKO) return "Crypto market prices";
  if (provider === IntegrationProvider.ALPHA_VANTAGE) return "Free ETF daily prices";
  return "Paid ETF exchange quotes";
}

function providerName(provider: IntegrationProviderName) {
  if (provider === IntegrationProvider.OPENAI) return "OpenAI";
  if (provider === IntegrationProvider.COINGECKO) return "CoinGecko";
  if (provider === IntegrationProvider.ALPHA_VANTAGE) return "Alpha Vantage";
  return "Twelve Data";
}

function sourceLabel(source: Integration["source"]) {
  if (source === "DATABASE") return "Database";
  if (source === "ENVIRONMENT") return "Environment";
  if (source === "PUBLIC") return "Public fallback";
  if (source === "UNAVAILABLE") return "Unavailable";
  return "Not configured";
}

function sourceTone(source: Integration["source"]): "neutral" | "primary" | "success" | "warning" | "destructive" {
  if (source === "DATABASE") return "success";
  if (source === "ENVIRONMENT") return "primary";
  if (source === "UNAVAILABLE") return "destructive";
  if (source === "NONE") return "warning";
  return "neutral";
}

const inputClassName = "h-11 w-full rounded-lg border border-border bg-surface-strong px-3 text-sm text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary/60";
