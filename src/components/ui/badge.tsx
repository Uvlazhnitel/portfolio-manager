import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "destructive";
};

export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        tone === "neutral" && "border-border bg-surface-strong text-muted",
        tone === "primary" && "border-primary/30 bg-primary/12 text-primary",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "destructive" && "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
