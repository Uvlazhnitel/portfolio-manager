"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, CircleDollarSign } from "lucide-react";
import { navigationItems } from "@/components/layout/navigation";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-border bg-surface px-4 py-5 lg:flex lg:flex-col">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/portfolio" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/25">
            <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">Wealth Copilot</span>
            <span className="block text-xs text-muted">USD base</span>
          </span>
        </Link>
        <button
          type="button"
          aria-label="Collapse sidebar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-primary/50 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Primary navigation" className="space-y-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition",
                  active
                    ? "bg-primary/14 text-foreground ring-1 ring-primary/25"
                    : "hover:bg-surface-strong hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
              {"children" in item ? (
                <div className="ml-5 mt-1 space-y-1 border-l border-border pl-3">
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = pathname === child.href;

                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition",
                          childActive
                            ? "bg-primary/12 text-foreground"
                            : "hover:bg-surface-strong hover:text-foreground",
                        )}
                      >
                        <ChildIcon className="h-4 w-4" aria-hidden="true" />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
