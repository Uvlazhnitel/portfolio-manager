"use client";

import { cn } from "@/lib/utils";

export const chartRangeOptions = [
  { value: "1D", label: "1D" },
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
] as const;

export type ChartRange = (typeof chartRangeOptions)[number]["value"];

export const defaultChartRange: ChartRange = "ALL";

export type ChartRangePoint = {
  date: string;
};

export function filterChartRowsByRange<Row extends ChartRangePoint>(rows: Row[], range: ChartRange): Row[] {
  if (range === "ALL" || rows.length === 0) return rows;
  const latestTime = Math.max(...rows.map((row) => parseUtcDate(row.date)));
  const cutoffTime = subtractRange(latestTime, range);
  return rows.filter((row) => parseUtcDate(row.date) >= cutoffTime);
}

export function chartRangeLabel(range: ChartRange, trackingStartedAt: string | null, formatDate: (value: string) => string) {
  if (range === "ALL") return trackingStartedAt ? `Since ${formatDate(trackingStartedAt)}` : "All history";
  return `Last ${chartRangeOptions.find((option) => option.value === range)?.label ?? range}`;
}

export function ChartRangeSelector({
  value,
  onChange,
  className,
}: {
  value: ChartRange;
  onChange: (value: ChartRange) => void;
  className?: string;
}) {
  return (
    <div className={cn("max-w-full overflow-x-auto", className)}>
      <div className="inline-flex min-w-max rounded-full border border-border bg-surface p-1">
        {chartRangeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-8 rounded-full px-3 text-xs font-medium text-muted transition hover:text-foreground",
              value === option.value && "bg-primary text-white shadow-sm shadow-primary/20 hover:text-white",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function subtractRange(latestTime: number, range: Exclude<ChartRange, "ALL">) {
  const latestDate = new Date(latestTime);
  if (range === "1D" || range === "7D") {
    const cutoff = new Date(latestTime);
    cutoff.setUTCDate(cutoff.getUTCDate() - (range === "1D" ? 1 : 7));
    return cutoff.getTime();
  }
  if (range === "1M") return Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() - 1, latestDate.getUTCDate());
  if (range === "3M") return Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() - 3, latestDate.getUTCDate());
  return Date.UTC(latestDate.getUTCFullYear() - 1, latestDate.getUTCMonth(), latestDate.getUTCDate());
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime();
}
