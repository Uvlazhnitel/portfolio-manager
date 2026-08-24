"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { refreshPricesAction } from "@/features/market-data/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PriceRefresh({ compact = false }: { compact?: boolean }) {
  const [state, action, isPending] = useActionState(refreshPricesAction, {
    ok: false,
    message: "",
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={isPending}>
          <RefreshCw className={cn("h-4 w-4", !compact && "mr-2", isPending && "animate-spin")} aria-hidden="true" />
          {compact ? <span className="sr-only">Refresh prices</span> : isPending ? "Refreshing..." : "Refresh prices"}
        </Button>
      </form>
      {state.message ? (
        <p className={cn("max-w-xs text-right text-xs", state.ok ? "text-muted" : "text-destructive")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
