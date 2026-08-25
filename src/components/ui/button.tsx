import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ children, className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-primary text-white shadow-sm shadow-primary/20 hover:bg-primary/90",
        variant === "secondary" &&
          "border border-border bg-surface-strong text-foreground hover:border-primary/50",
        variant === "ghost" && "text-muted hover:bg-surface-strong hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
