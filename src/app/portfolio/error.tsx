"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function PortfolioError({ reset }: { reset: () => void }) {
  return (
    <Card className="flex min-h-[320px] flex-col items-center justify-center text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">Portfolio failed to load</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">
        Check the database connection and try again.
      </p>
      <Button className="mt-6" onClick={reset}>
        Retry
      </Button>
    </Card>
  );
}
