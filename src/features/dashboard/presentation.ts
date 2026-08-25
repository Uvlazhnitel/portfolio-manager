import type { AssetClass } from "@prisma/client";
import { contributionClassLabels } from "@/features/contributions/presentation";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";

export function formatDashboardCurrency(value: string, currency: string) {
  return formatDecimalCurrency(value, currency);
}

export function formatDashboardSignedCurrency(value: string, currency: string) {
  const sign = decimalSign(value);
  if (sign === null) return "—";
  const formatted = formatDashboardCurrency(value.replace(/^-/, ""), currency);
  return `${sign >= 0 ? "+" : "−"}${formatted}`;
}

export function formatDashboardPercent(value: string) {
  return formatDecimalPercent(value, 1);
}

export function strategyWarningText(warning: {
  code: string;
  assetClass: AssetClass;
  currentPercent: string;
  limitPercent: string;
}) {
  return `${contributionClassLabels[warning.assetClass]} is ${formatDashboardPercent(warning.currentPercent)}, ${warning.code.endsWith("ABOVE_MAX") ? "above the configured maximum" : "below the configured minimum"} of ${formatDashboardPercent(warning.limitPercent)}.`;
}
