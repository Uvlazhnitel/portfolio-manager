import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataQualityItem = {
  message: string;
  tone?: "warning" | "destructive";
};

type DataQualitySummaryProps = {
  items: DataQualityItem[];
  label?: string;
  className?: string;
};

export function DataQualitySummary({
  items,
  label = "Data quality",
  className,
}: DataQualitySummaryProps) {
  const uniqueItems = deduplicateDataQualityItems(items);
  if (uniqueItems.length === 0) return null;

  const hasDestructive = uniqueItems.some((item) => item.tone === "destructive");

  return (
    <details className={cn("group relative z-20 w-fit max-w-full text-sm", className)}>
      <summary
        aria-label={`${label}: ${uniqueItems.length} ${uniqueItems.length === 1 ? "issue" : "issues"}`}
        className={cn(
          "flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-muted shadow-sm transition hover:border-primary/35 hover:text-foreground [&::-webkit-details-marker]:hidden",
          hasDestructive && "border-destructive/35 text-destructive",
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{label}</span>
        <span className={cn(
          "inline-flex min-w-5 items-center justify-center rounded-md bg-surface-strong px-1.5 py-0.5 text-xs tabular-nums text-muted",
          hasDestructive && "bg-destructive/10 text-destructive",
        )}>
          {uniqueItems.length}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 max-h-80 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-border bg-card p-4 text-foreground shadow-xl shadow-black/25 sm:w-[min(24rem,calc(100vw-3rem))]">
        <p className="font-medium">{label}</p>
        <ul className="mt-3 space-y-2 pl-5 text-sm leading-5 text-muted">
          {uniqueItems.map((item) => (
            <li key={item.message} className={cn("list-disc", item.tone === "destructive" && "text-destructive")}>
              {item.message}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function deduplicateDataQualityItems(items: DataQualityItem[]) {
  const uniqueItems = new Map<string, DataQualityItem>();

  for (const item of items) {
    const message = item.message.trim();
    if (!message) continue;

    const existing = uniqueItems.get(message);
    if (!existing || item.tone === "destructive") {
      uniqueItems.set(message, { ...item, message });
    }
  }

  return [...uniqueItems.values()];
}
