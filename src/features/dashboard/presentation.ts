import type { AssetClass } from "@prisma/client";
import { contributionClassLabels } from "@/features/contributions/presentation";

export function formatDashboardCurrency(value: string, currency: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount)
    : "—";
}

export function formatDashboardSignedCurrency(value: string, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount >= 0 ? "+" : "−"}${formatDashboardCurrency(String(Math.abs(amount)), currency)}`;
}

export function formatDashboardPercent(value: string) {
  const amount = Number(value);
  return `${Number.isFinite(amount) ? amount.toFixed(1) : "0.0"}%`;
}

export function strategyWarningText(warning: {
  code: string;
  assetClass: AssetClass;
  currentPercent: string;
  limitPercent: string;
}) {
  return `${contributionClassLabels[warning.assetClass]} is ${formatDashboardPercent(warning.currentPercent)}, ${warning.code.endsWith("ABOVE_MAX") ? "above the configured maximum" : "below the configured minimum"} of ${formatDashboardPercent(warning.limitPercent)}.`;
}
