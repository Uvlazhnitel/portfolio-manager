import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataQualityItem = {
  message: string;
  tone?: "warning" | "destructive";
};

type DataQualitySummaryProps = {
  items: DataQualityItem[];
  okText?: string;
  label?: string;
  className?: string;
};

export function DataQualitySummary({
  items,
  okText = "Data complete",
  label = "Data quality",
  className,
}: DataQualitySummaryProps) {
  if (items.length === 0) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm text-success", className)}>
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{okText}</span>
      </div>
    );
  }

  const hasDestructive = items.some((item) => item.tone === "destructive");
  const toneClass = hasDestructive
    ? "border-destructive/25 bg-destructive/10 text-destructive"
    : "border-warning/25 bg-warning/10 text-warning";

  return (
    <details className={cn("group min-w-0 rounded-lg border px-3 py-2 text-sm", toneClass, className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-current/80">
          {items.length === 1 ? items[0].message : `${items.length} items need attention`}
        </span>
        <span className="text-xs text-current/70 group-open:hidden">Details</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-6 text-current/85">
        {items.map((item) => <li key={item.message} className="list-disc">{item.message}</li>)}
      </ul>
    </details>
  );
}
