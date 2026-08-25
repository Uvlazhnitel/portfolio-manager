import type { AllocationStatus, StrategyWarning } from "@/features/portfolio-engine";
import { formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";

export function scenarioWarningText(warning: Pick<StrategyWarning, "assetClass" | "currentPercent" | "limitPercent" | "code">) {
  const label = classLabel(warning.assetClass);
  if (warning.code.endsWith("_ABOVE_MAX")) {
    return `This transaction would move ${label.toLowerCase()} to ${formatPercent(warning.currentPercent)}, above your configured maximum of ${formatPercent(warning.limitPercent)}.`;
  }
  return `${label} would be ${formatPercent(warning.currentPercent)}, below your configured minimum of ${formatPercent(warning.limitPercent)}.`;
}

export function classLabel(value: string) {
  if (value === "ETF") return "ETF";
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function statusLabel(status: AllocationStatus) {
  return status.toLowerCase().replace("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function formatPercent(value: string) {
  return formatDecimalPercent(value);
}

export function formatCurrency(value: string, currency = "EUR") {
  return formatDecimalCurrency(value, currency);
}
