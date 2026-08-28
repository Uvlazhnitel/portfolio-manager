import type { HTMLAttributes } from "react";
import { decimalSign, formatDecimalCurrency, formatDecimalPercent } from "@/lib/format/decimal";
import { cn } from "@/lib/utils";

type PnlFormatProps =
  | { format: "currency"; currency: string; places?: number }
  | { format: "percent"; currency?: never; places?: number };

type PnlIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  value: string | null;
  unavailableLabel?: string;
  size?: "sm" | "md" | "lg";
} & PnlFormatProps;

export function PnlIndicator({ value, unavailableLabel = "Unavailable", size = "md", className, format, currency, places, ...props }: PnlIndicatorProps) {
  const sign = value === null ? null : decimalSign(value);
  const label = sign === null || value === null ? unavailableLabel : signedLabel(value, sign, { format, currency, places } as PnlFormatProps);
  const tone = sign === null || sign === 0 ? "neutral" : sign > 0 ? "positive" : "negative";

  return (
    <span
      className={cn(
        "inline-flex min-w-fit items-center justify-end rounded-md border font-semibold tabular-nums",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-3 py-1.5 text-lg",
        tone === "positive" && "border-success/30 bg-success/10 text-success",
        tone === "negative" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "neutral" && "border-border bg-surface-strong text-muted",
        className,
      )}
      data-tone={tone}
      {...props}
    >
      {label}
    </span>
  );
}

function signedLabel(value: string, sign: -1 | 0 | 1, props: PnlFormatProps) {
  const absolute = value.replace(/^-/, "");
  const formatted = props.format === "currency"
    ? formatDecimalCurrency(absolute, props.currency, props.places ?? 2)
    : formatDecimalPercent(absolute, props.places ?? 1);

  if (sign === 0) return formatted;
  return `${sign > 0 ? "+" : "−"}${formatted}`;
}
