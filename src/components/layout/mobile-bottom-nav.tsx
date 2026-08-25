"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { mobileNavigationItems } from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const pathname = usePathname();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
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

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            aria-label="Add transaction"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>

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

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-background/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm lg:hidden">
          <Card className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full overflow-y-auto overscroll-contain rounded-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Add transaction</h2>
                <p className="mt-1 text-sm text-muted">
                  Transaction entry will be added in the next portfolio task.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close add transaction modal"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-primary/50 hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setIsModalOpen(false)}>Done</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
