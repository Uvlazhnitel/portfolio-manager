import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className, ...props }: CardProps) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-5 shadow-sm shadow-black/10", className)}
      {...props}
    >
      {children}
    </section>
  );
}
