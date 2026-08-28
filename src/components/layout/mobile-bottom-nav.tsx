"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { mobileAddActionHref, mobileNavigationItems } from "@/components/layout/navigation";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 items-center gap-1">
        {mobileNavigationItems.slice(0, 2).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted",
                active ? "bg-primary/14 text-foreground" : "hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}

        <Link
          href={mobileAddActionHref}
          aria-label="Add asset or transaction"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </Link>

        {mobileNavigationItems.slice(2).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted",
                active ? "bg-primary/14 text-foreground" : "hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
